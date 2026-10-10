import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DeviceAccessGuard } from './device-access.guard';

function makeContext(params: Record<string, string>, user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params, user }),
    }),
  } as unknown as ExecutionContext;
}

describe('DeviceAccessGuard', () => {
  let prisma: { device: { findUnique: jest.Mock } };
  let auditLogs: { log: jest.Mock };
  let guard: DeviceAccessGuard;

  beforeEach(() => {
    prisma = { device: { findUnique: jest.fn() } };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    guard = new DeviceAccessGuard(prisma as never, auditLogs as never);
  });

  it('allows routes with no :id param through untouched', async () => {
    const result = await guard.canActivate(makeContext({}, { role: Role.IT_TECHNICIAN }));
    expect(result).toBe(true);
    expect(prisma.device.findUnique).not.toHaveBeenCalled();
  });

  it('grants ADMIN and SECURITY_ANALYST access to a device in their own organization', async () => {
    prisma.device.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    for (const role of [Role.ADMIN, Role.SECURITY_ANALYST]) {
      const result = await guard.canActivate(
        makeContext({ id: 'device-1' }, { role, departmentId: 'dept-a', organizationId: 'org-1' }),
      );
      expect(result).toBe(true);
    }
  });

  it('allows an IT_TECHNICIAN to access a device in their own department and organization', async () => {
    prisma.device.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    const result = await guard.canActivate(
      makeContext(
        { id: 'device-1' },
        { role: Role.IT_TECHNICIAN, departmentId: 'dept-a', organizationId: 'org-1' },
      ),
    );
    expect(result).toBe(true);
  });

  it('denies an IT_TECHNICIAN access to a device in a different department (same organization)', async () => {
    prisma.device.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await expect(
      guard.canActivate(
        makeContext(
          { id: 'device-1' },
          {
            role: Role.IT_TECHNICIAN,
            departmentId: 'dept-b',
            organizationId: 'org-1',
            email: 'tech@mirqab.local',
          },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * Phase 2.6B — cross-organization IDOR/BOLA: a device belonging to
   * Organization B must be unreachable by an Organization A user, even
   * when that user is ADMIN/SECURITY_ANALYST (who are exempt from the
   * department check but never from the organization check).
   */
  it.each([Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN])(
    'denies %s access to a device in a different organization',
    async (role) => {
      prisma.device.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-B' });
      await expect(
        guard.canActivate(
          makeContext(
            { id: 'device-1' },
            { role, departmentId: 'dept-a', organizationId: 'org-A', email: 'user@org-a.local' },
          ),
        ),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('denies a user with no organization assigned, even against a device in a real organization', async () => {
    prisma.device.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await expect(
      guard.canActivate(
        makeContext(
          { id: 'device-1' },
          { role: Role.ADMIN, departmentId: null, organizationId: null, email: 'pending@mirqab.local' },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('logs an audit entry for the denied user when access is denied (Phase 6)', async () => {
    prisma.device.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await expect(
      guard.canActivate(
        makeContext(
          { id: 'device-1' },
          {
            role: Role.IT_TECHNICIAN,
            departmentId: 'dept-b',
            organizationId: 'org-1',
            email: 'tech@mirqab.local',
          },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(auditLogs.log).toHaveBeenCalledWith(
      'tech@mirqab.local',
      expect.stringContaining('Access denied'),
      'device-1',
    );
  });

  it('does not log an audit entry when access is granted', async () => {
    prisma.device.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await guard.canActivate(
      makeContext(
        { id: 'device-1' },
        { role: Role.IT_TECHNICIAN, departmentId: 'dept-a', organizationId: 'org-1' },
      ),
    );
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('lets a missing device fall through to a 404 from the service layer, not a 403 here', async () => {
    prisma.device.findUnique.mockResolvedValue(null);
    const result = await guard.canActivate(
      makeContext(
        { id: 'does-not-exist' },
        { role: Role.IT_TECHNICIAN, departmentId: 'dept-a', organizationId: 'org-1' },
      ),
    );
    expect(result).toBe(true);
  });
});
