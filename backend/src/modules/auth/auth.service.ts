import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UserEntity } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
import { AuthTokens } from './interfaces/auth-tokens.interface';
import { JwtPayload, RefreshTokenPayload } from './interfaces/jwt-payload.interface';

/** How long a "forgot password" link stays valid. */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async register(dto: RegisterDto): Promise<UserEntity> {
    const user = await this.usersService.create(dto);
    return new UserEntity(user);
  }

  /**
   * Public "Create account" flow, reachable from the SOC Dashboard's own
   * sign-in screen. Provisions IT_TECHNICIAN — the *lowest*-privilege SOC
   * role that this frontend actually lets in (EMPLOYEE is hard-blocked from
   * the dashboard by AuthStore.rejectIfEmployee, reserved for the separate
   * employee-desktop app). There is no `role` field on SignupDto, so a
   * self-service caller can never request ADMIN/SECURITY_ANALYST directly.
   *
   * IT_TECHNICIAN still carries real SOC privileges (read all incidents,
   * create/apply response actions, tickets, policies), so the account is
   * provisioned inactive and does NOT auto-sign-in — an administrator must
   * approve it (`PATCH /users/:id/activate`-style flow) before it can log
   * in. This closes an unauthenticated-privilege-escalation path where
   * anyone who can reach this endpoint previously got a working SOC account
   * with zero verification.
   */
  async signup(dto: SignupDto, metadata: RequestMetadata = {}): Promise<{ message: string }> {
    const user = await this.usersService.create(
      {
        email: dto.email,
        password: dto.password,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: Role.IT_TECHNICIAN,
      },
      { isActive: false },
    );
    await this.auditLogs.log(user.email, 'Signed up (pending admin approval)');
    this.logger.log(
      `New self-signup pending approval: ${user.email} from ${metadata.ipAddress ?? 'unknown IP'}`,
    );
    return {
      message:
        'Account created. An administrator must approve your account before you can sign in.',
    };
  }

  /**
   * Always resolves with the same generic message — never reveals whether
   * the email is registered, and never returns the reset token/link to the
   * caller. No SMTP provider is wired up yet (see docs/phases), so the link
   * can't be emailed to the user; until that lands, it's logged server-side
   * only (visible to whoever operates the backend, not to the HTTP caller).
   * Returning it in the API response would let anyone who knows a
   * registered email harvest a working reset link for that account.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const generic = {
      message: 'If an account exists for that email, a reset link has been generated.',
    };
    const user = await this.usersService.findByEmail(dto.email);

    if (!user || !user.isActive) {
      return generic;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    await this.auditLogs.log(user.email, 'Requested password reset');

    const frontendUrl =
      this.configService.get<string>('app.frontendUrl') ?? 'http://localhost:5173';
    const resetUrl = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${rawToken}`;
    // TODO: send `resetUrl` by email once an SMTP provider is configured.
    // Until then it is only available server-side, never over the API — but
    // Phase 11: the raw token is a working account-takeover credential for
    // as long as PASSWORD_RESET_TTL_MS allows, so it must never reach
    // production logs (container logs are routinely shipped to log
    // aggregation, read by ops staff, etc. — a materially wider audience
    // than "whoever operates the backend" the original comment assumed).
    // Non-production keeps the full URL logged since that's the only way to
    // exercise this flow locally without a real SMTP provider wired up.
    if (process.env.NODE_ENV === 'production') {
      this.logger.log(`Password reset requested for ${user.email} (delivery not configured)`);
    } else {
      this.logger.log(`Password reset requested for ${user.email}: ${resetUrl}`);
    }

    return generic;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.token);
    const storedToken = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!storedToken || storedToken.usedAt || storedToken.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }

    const user = await this.usersService.findById(storedToken.userId);
    if (!user || !user.isActive) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }

    const saltRounds = this.configService.get<number>('bcrypt.saltRounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.newPassword, saltRounds);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: storedToken.id },
        data: { usedAt: new Date() },
      }),
      // A password reset likely means the old credentials were compromised —
      // every existing session (on every device) is revoked, same as the
      // replay-detection path in `refresh()`.
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditLogs.log(user.email, 'Reset password');

    return { message: 'Password updated. Please sign in with your new password.' };
  }

  async login(dto: LoginDto, metadata: RequestMetadata = {}): Promise<AuthTokens> {
    let user: User;
    try {
      user = await this.validateCredentials(dto.email, dto.password);
    } catch (error) {
      // Phase 6 (closes baseline finding P1-5): failed logins were
      // previously only rate-limited, never recorded — no forensic trail of
      // brute-force attempts existed anywhere a security analyst could see.
      // The attempted email is the same value already validated by
      // LoginDto's @IsEmail()/@MaxLength(254) and the global null-byte
      // guard (Phase 5) before it ever reaches here — never an unbounded or
      // unvalidated client string. Deliberately does not distinguish
      // "no such user" from "wrong password" in the audit text, matching
      // validateCredentials' own identical error message for both cases —
      // an audit reader (or an attacker who somehow read this table) still
      // cannot enumerate which emails exist.
      await this.auditLogs.log(dto.email, 'Failed login attempt (invalid credentials)');
      throw error;
    }
    await this.usersService.updateLastLogin(user.id);
    await this.auditLogs.log(user.email, 'Signed in');
    return this.issueTokens(user, metadata);
  }

  /**
   * Rotates a refresh token: the presented token is single-use. Any replay
   * of an already-rotated token revokes the entire token family for that
   * user, since it can only mean the token was stolen from storage.
   */
  async refresh(
    payload: RefreshTokenPayload,
    rawToken: string,
    metadata: RequestMetadata = {},
  ): Promise<AuthTokens> {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { id: payload.tokenId },
    });

    const tokenHash = this.hashToken(rawToken);

    if (!storedToken || storedToken.tokenHash !== tokenHash || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or has expired');
    }

    if (storedToken.revokedAt) {
      await this.revokeAllUserTokens(storedToken.userId);
      throw new UnauthorizedException('Refresh token has already been used');
    }

    const user = await this.usersService.findById(storedToken.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User no longer exists or is inactive');
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user, metadata);
  }

  async logout(tokenId: string, actorEmail: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id: tokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.auditLogs.log(actorEmail, 'Signed out');
  }

  async getProfile(userId: string): Promise<UserEntity> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return new UserEntity(user);
  }

  /** Decodes a refresh token for logout purposes without rejecting expired ones. */
  decodeRefreshToken(rawToken: string): RefreshTokenPayload {
    try {
      return this.jwtService.verify<RefreshTokenPayload>(rawToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        ignoreExpiration: true,
        // Phase 11: see the matching comment in jwt.strategy.ts — this is
        // the one other place in the app that calls jsonwebtoken.verify()
        // directly rather than through a Passport strategy.
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async validateCredentials(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return user;
  }

  private async issueTokens(user: User, metadata: RequestMetadata): Promise<AuthTokens> {
    const basePayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
    };

    const accessExpiresIn = this.configService.get<string>('jwt.accessExpiresIn') ?? '15m';
    const refreshExpiresIn = this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d';

    const accessToken = this.jwtService.sign(basePayload, {
      secret: this.configService.get<string>('jwt.accessSecret'),
      expiresIn: accessExpiresIn,
    });

    const tokenId = crypto.randomUUID();
    const refreshPayload: RefreshTokenPayload = { ...basePayload, tokenId };

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: refreshExpiresIn,
    });

    await this.prisma.refreshToken.create({
      data: {
        id: tokenId,
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.resolveExpiryDate(refreshExpiresIn),
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.resolveExpirySeconds(accessExpiresIn),
    };
  }

  private async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private resolveExpiryDate(duration: string): Date {
    return new Date(Date.now() + this.resolveExpirySeconds(duration) * 1000);
  }

  private resolveExpirySeconds(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) {
      return 900;
    }
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return Number(match[1]) * multipliers[match[2]];
  }
}
