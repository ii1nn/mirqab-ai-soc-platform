import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TicketAccessGuard } from './ticket-access.guard';

function makeContext(params: Record<string, string>, user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params, user }),
    }),
  } as unknown as ExecutionContext;
}

describe('TicketAccessGuard', () => {
  let prisma: { ticket: { findUnique: jest.Mock } };
  let auditLogs: { log: jest.Mock };
  let guard: TicketAccessGuard;

  beforeEach(() => {
    prisma = { ticket: { findUnique: jest.fn() } };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    guard = new TicketAccessGuard(prisma as never, auditLogs as never);
  });

  it('allows routes with no :id param through untouched', async () => {
    const result = await guard.canActivate(makeContext({}, { role: Role.IT_TECHNICIAN }));
    expect(result).toBe(true);
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  it('grants ADMIN access to a ticket in their own organization without checking department', async () => {
    prisma.ticket.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    const result = await guard.canActivate(
      makeContext(
        { id: 'ticket-1' },
        { role: Role.ADMIN, departmentId: 'dept-b', organizationId: 'org-1' },
      ),
    );
    expect(result).toBe(true);
  });

  it('allows an IT_TECHNICIAN to access a ticket in their own department and organization', async () => {
    prisma.ticket.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    const result = await guard.canActivate(
      makeContext(
        { id: 'ticket-1' },
        { role: Role.IT_TECHNICIAN, departmentId: 'dept-a', organizationId: 'org-1' },
      ),
    );
    expect(result).toBe(true);
  });

  it('denies an IT_TECHNICIAN access to a ticket in a different department (same organization)', async () => {
    prisma.ticket.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await expect(
      guard.canActivate(
        makeContext(
          { id: 'ticket-1' },
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
   * Phase 2.6B — cross-organization IDOR/BOLA: a ticket belonging to
   * Organization B must be unreachable by an Organization A user, even
   * when that user is ADMIN.
   */
  it.each([Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN])(
    'denies %s access to a ticket in a different organization',
    async (role) => {
      prisma.ticket.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-B' });
      await expect(
        guard.canActivate(
          makeContext(
            { id: 'ticket-1' },
            { role, departmentId: 'dept-a', organizationId: 'org-A', email: 'user@org-a.local' },
          ),
        ),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('logs an audit entry for the denied user when access is denied (Phase 6)', async () => {
    prisma.ticket.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await expect(
      guard.canActivate(
        makeContext(
          { id: 'ticket-1' },
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
      'ticket-1',
    );
  });

  it('does not log an audit entry when access is granted', async () => {
    prisma.ticket.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await guard.canActivate(
      makeContext(
        { id: 'ticket-1' },
        { role: Role.IT_TECHNICIAN, departmentId: 'dept-a', organizationId: 'org-1' },
      ),
    );
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
