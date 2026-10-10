import { Exclude } from 'class-transformer';
import { Role, User as PrismaUser } from '@prisma/client';

/**
 * Serialized representation of a User returned by the API. `passwordHash`
 * is excluded by the global ClassSerializerInterceptor — never sent to clients.
 */
export class UserEntity implements Omit<PrismaUser, 'passwordHash'> {
  // Assigned via Object.assign in the constructor, not field initializers —
  // definite assignment assertions are correct here, not a workaround.
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
  role!: Role;
  isActive!: boolean;
  lastLoginAt!: Date | null;
  /** Requirement #30: scopes IT_TECHNICIAN case access — see IncidentAccessGuard. */
  departmentId!: string | null;
  /** Phase 2.6B: the tenant boundary — see AuthenticatedUser's doc comment. */
  organizationId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  @Exclude()
  passwordHash?: string;

  constructor(partial: Partial<PrismaUser>) {
    Object.assign(this, partial);
  }
}
