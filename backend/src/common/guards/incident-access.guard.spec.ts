import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IncidentAccessGuard } from './incident-access.guard';

function makeContext(params: Record<string, string>, user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params, user }),
    }),
  } as unknown as ExecutionContext;
}

describe('IncidentAccessGuard', () => {
  let prisma: { incident: { findUnique: jest.Mock } };
  let auditLogs: { log: jest.Mock };
  let guard: IncidentAccessGuard;

  beforeEach(() => {
    prisma = { incident: { findUnique: jest.fn() } };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    guard = new IncidentAccessGuard(prisma as never, auditLogs as never);
  });

  it('allows routes with no :id param through untouched (list/create endpoints)', async () => {
    const result = await guard.canActivate(makeContext({}, { role: Role.IT_TECHNICIAN }));
    expect(result).toBe(true);
    expect(prisma.incident.findUnique).not.toHaveBeenCalled();
  });

  it('denies when there is no authenticated user on the request', async () => {
    const result = await guard.canActivate(makeContext({ id: 'incident-1' }, undefined));
    expect(result).toBe(false);
  });

  it('grants ADMIN org-wide access (within their own organization) without checking the incident department', async () => {
    prisma.incident.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    const result = await guard.canActivate(
      makeContext(
        { id: 'incident-1' },
        { role: Role.ADMIN, departmentId: 'dept-b', organizationId: 'org-1' },
      ),
    );
    expect(result).toBe(true);
  });

  it('grants SECURITY_ANALYST org-wide access (within their own organization) without checking the incident department', async () => {
    prisma.incident.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    const result = await guard.canActivate(
      makeContext(
        { id: 'incident-1' },
        { role: Role.SECURITY_ANALYST, departmentId: 'dept-b', organizationId: 'org-1' },
      ),
    );
    expect(result).toBe(true);
  });

  it('allows an IT_TECHNICIAN to access a case in their own department and organization', async () => {
    prisma.incident.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    const result = await guard.canActivate(
      makeContext(
        { id: 'incident-1' },
        { role: Role.IT_TECHNICIAN, departmentId: 'dept-a', organizationId: 'org-1' },
      ),
    );
    expect(result).toBe(true);
  });

  it('denies an IT_TECHNICIAN access to a case in a different department (same organization)', async () => {
    prisma.incident.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await expect(
      guard.canActivate(
        makeContext(
          { id: 'incident-1' },
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
   * Phase 2.6B — cross-organization IDOR/BOLA: an incident belonging to
   * Organization B must be unreachable by an Organization A user, even
   * when that user is ADMIN/SECURITY_ANALYST.
   */
  it.each([Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN])(
    'denies %s access to an incident in a different organization',
    async (role) => {
      prisma.incident.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-B' });
      await expect(
        guard.canActivate(
          makeContext(
            { id: 'incident-1' },
            { role, departmentId: 'dept-a', organizationId: 'org-A', email: 'user@org-a.local' },
          ),
        ),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('logs an audit entry for the denied user when access is denied (Phase 6)', async () => {
    prisma.incident.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await expect(
      guard.canActivate(
        makeContext(
          { id: 'incident-1' },
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
      'incident-1',
    );
  });

  it('does not log an audit entry when access is granted', async () => {
    prisma.incident.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await guard.canActivate(
      makeContext(
        { id: 'incident-1' },
        {
          role: Role.IT_TECHNICIAN,
          departmentId: 'dept-a',
          organizationId: 'org-1',
          email: 'tech@mirqab.local',
        },
      ),
    );
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('fails closed: denies an IT_TECHNICIAN with no department assigned against a departmented case', async () => {
    prisma.incident.findUnique.mockResolvedValue({ departmentId: 'dept-a', organizationId: 'org-1' });
    await expect(
      guard.canActivate(
        makeContext(
          { id: 'incident-1' },
          {
            role: Role.IT_TECHNICIAN,
            departmentId: null,
            organizationId: 'org-1',
            email: 'tech@mirqab.local',
          },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * Phase 2.6B: this is a deliberate BEHAVIOR CHANGE from department
   * scoping's own null-departmentId exception. An incident with no
   * organization (device unresolved at ingestion) is now DENIED to every
   * caller, never allowed through — see assertOrganizationAccess's own
   * comment for why treating a null organization as "nothing to scope
   * against" would be equivalent to treating it as visible to every
   * organization, which this phase's design explicitly rules out.
   */
  it('denies access to an incident with no organization at all (never treated as belonging to every organization)', async () => {
    prisma.incident.findUnique.mockResolvedValue({ departmentId: null, organizationId: null });
    await expect(
      guard.canActivate(
        makeContext(
          { id: 'incident-1' },
          { role: Role.ADMIN, departmentId: null, organizationId: 'org-1' },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets a missing incident fall through to a 404 from the service layer, not a 403 here', async () => {
    prisma.incident.findUnique.mockResolvedValue(null);
    const result = await guard.canActivate(
      makeContext(
        { id: 'does-not-exist' },
        { role: Role.IT_TECHNICIAN, departmentId: 'dept-a', organizationId: 'org-1' },
      ),
    );
    expect(result).toBe(true);
  });
});
