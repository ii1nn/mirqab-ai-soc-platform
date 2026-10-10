import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let prisma: {
    refreshToken: Record<'create' | 'findUnique' | 'update' | 'updateMany', jest.Mock>;
    passwordResetToken: Record<'create', jest.Mock>;
  };
  let jwtService: jest.Mocked<JwtService>;
  let auditLogs: jest.Mocked<Pick<AuditLogsService, 'log'>>;

  const mockUser = {
    id: 'user-1',
    email: 'analyst@mirqab.local',
    passwordHash: '',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: Role.SECURITY_ANALYST,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    mockUser.passwordHash = await bcrypt.hash('CorrectHorseBattery1!', 4);
  });

  beforeEach(async () => {
    usersService = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      updateLastLogin: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    prisma = {
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      passwordResetToken: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('signed.jwt.token'),
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };

    const configValues: Record<string, unknown> = {
      'jwt.accessSecret': 'access-secret',
      'jwt.accessExpiresIn': '15m',
      'jwt.refreshSecret': 'refresh-secret',
      'jwt.refreshExpiresIn': '7d',
      'app.frontendUrl': 'http://localhost:5173',
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: (key: string) => configValues[key] } },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('issues access and refresh tokens for valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as never);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      prisma.refreshToken.create.mockResolvedValue({});

      const tokens = await authService.login({
        email: mockUser.email,
        password: 'CorrectHorseBattery1!',
      });

      expect(tokens.accessToken).toBe('signed.jwt.token');
      expect(tokens.refreshToken).toBe('signed.jwt.token');
      expect(usersService.updateLastLogin).toHaveBeenCalledWith(mockUser.id);
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('rejects an invalid password', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as never);

      await expect(
        authService.login({ email: mockUser.email, password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'nobody@mirqab.local', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('Phase 6: audit-logs a failed login attempt against the attempted email, never the "Signed in" event', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as never);

      await expect(
        authService.login({ email: mockUser.email, password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(auditLogs.log).toHaveBeenCalledWith(
        mockUser.email,
        expect.stringContaining('Failed login attempt'),
      );
      expect(auditLogs.log).not.toHaveBeenCalledWith(mockUser.email, 'Signed in');
      expect(usersService.updateLastLogin).not.toHaveBeenCalled();
    });

    it('Phase 6: audit-logs a failed login attempt for an unknown email using the attempted address, not a real user identity', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'nobody@mirqab.local', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(auditLogs.log).toHaveBeenCalledWith(
        'nobody@mirqab.local',
        expect.stringContaining('Failed login attempt'),
      );
    });

    it('rejects a deactivated account', async () => {
      usersService.findByEmail.mockResolvedValue({ ...mockUser, isActive: false } as never);

      await expect(
        authService.login({ email: mockUser.email, password: 'CorrectHorseBattery1!' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('rejects a token whose hash does not match the stored record', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: mockUser.id,
        tokenHash: 'different-hash',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        authService.refresh(
          { sub: mockUser.id, email: mockUser.email, role: mockUser.role, tokenId: 'token-1' },
          'raw-refresh-token',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('revokes the whole session family when an already-used refresh token is replayed', async () => {
      const tokenHash = crypto.createHash('sha256').update('raw-refresh-token').digest('hex');

      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: mockUser.id,
        tokenHash,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        authService.refresh(
          { sub: mockUser.id, email: mockUser.email, role: mockUser.role, tokenId: 'token-1' },
          'raw-refresh-token',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rotates a valid, unused refresh token into a new pair', async () => {
      const tokenHash = crypto.createHash('sha256').update('raw-refresh-token').digest('hex');

      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: mockUser.id,
        tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});
      usersService.findById.mockResolvedValue(mockUser as never);

      const tokens = await authService.refresh(
        { sub: mockUser.id, email: mockUser.email, role: mockUser.role, tokenId: 'token-1' },
        'raw-refresh-token',
      );

      expect(tokens.accessToken).toBe('signed.jwt.token');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      jest.restoreAllMocks();
    });

    // Phase 11: a raw password-reset token is a working account-takeover
    // credential — see the comment above this log line in auth.service.ts.
    it('never logs the raw reset token/URL in production', async () => {
      process.env.NODE_ENV = 'production';
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      usersService.findByEmail.mockResolvedValue(mockUser as never);

      await authService.forgotPassword({ email: mockUser.email });

      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      const loggedMessages = logSpy.mock.calls.map((call) => String(call[0]));
      expect(loggedMessages.some((msg) => msg.includes('reset-password?token='))).toBe(false);
    });

    it('still logs the full reset URL outside production, for local testing without SMTP', async () => {
      process.env.NODE_ENV = 'development';
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      usersService.findByEmail.mockResolvedValue(mockUser as never);

      await authService.forgotPassword({ email: mockUser.email });

      const loggedMessages = logSpy.mock.calls.map((call) => String(call[0]));
      expect(loggedMessages.some((msg) => msg.includes('reset-password?token='))).toBe(true);
    });

    it('returns the same generic message whether or not the account exists (no enumeration)', async () => {
      usersService.findByEmail.mockResolvedValueOnce(mockUser as never);
      const existing = await authService.forgotPassword({ email: mockUser.email });

      usersService.findByEmail.mockResolvedValueOnce(null);
      const missing = await authService.forgotPassword({ email: 'nobody@mirqab.local' });

      expect(existing).toEqual(missing);
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    });
  });
});
