import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma/prisma.service';
import { organizationScopeWhere } from '../../common/guards/department-access.util';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * `isActive` is an internal-only override (never taken from CreateUserDto,
   * which is also used by the admin-only `POST /users` endpoint) — it exists
   * so callers like AuthService.signup can provision an account that can't
   * sign in until an admin approves it, without adding a client-settable
   * `isActive` field to the public DTO.
   */
  async create(dto: CreateUserDto, options: { isActive?: boolean } = {}): Promise<User> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const saltRounds = this.configService.get<number>('bcrypt.saltRounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        departmentId: dto.departmentId,
        isActive: options.isActive ?? true,
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  /** Phase 2.6B: organization-scoped — an ADMIN must only ever see and
   * manage members of their own organization, never every user in the
   * system (this endpoint previously returned literally every User row,
   * which was safe only under the single-tenant assumption this app no
   * longer makes). A null-organization caller (see AuthenticatedUser's doc
   * comment) sees nobody, fail-closed. */
  async findAll(user: AuthenticatedUser): Promise<User[]> {
    return this.prisma.user.findMany({
      where: organizationScopeWhere(user),
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Phase 2.6B: the acting admin and the target user must belong to the
   * same organization — an ADMIN from Organization A must never be able to
   * activate/deactivate a user in Organization B by knowing their id. */
  async setActive(id: string, isActive: boolean, actingUser: AuthenticatedUser): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.assertSameOrganization(actingUser, user.organizationId);

    return this.prisma.user.update({ where: { id }, data: { isActive } });
  }

  /** Requirement #30: assigns/clears which department an IT_TECHNICIAN's case
   * access is scoped to — see IncidentAccessGuard. Null = org-wide access.
   *
   * Phase 2.6B: both the target user AND the target department must belong
   * to the acting admin's own organization — closes two distinct
   * cross-tenant paths: assigning a user from another organization, and
   * assigning any user (even one in the caller's own org) to a department
   * that belongs to a different organization. Neither is inferred from the
   * other — a department id alone was never proof of anything before this
   * check existed. */
  async setDepartment(
    id: string,
    departmentId: string | null,
    actingUser: AuthenticatedUser,
  ): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.assertSameOrganization(actingUser, user.organizationId);

    if (departmentId) {
      const department = await this.prisma.department.findUnique({
        where: { id: departmentId },
        select: { organizationId: true },
      });
      if (!department || department.organizationId !== actingUser.organizationId) {
        throw new ForbiddenException('That department does not belong to your organization.');
      }
    }

    return this.prisma.user.update({ where: { id }, data: { departmentId } });
  }

  private assertSameOrganization(
    actingUser: AuthenticatedUser,
    targetOrganizationId: string | null,
  ): void {
    if (!actingUser.organizationId || targetOrganizationId !== actingUser.organizationId) {
      throw new ForbiddenException('You do not have access to this user.');
    }
  }
}
