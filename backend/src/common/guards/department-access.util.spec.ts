import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  assertDepartmentAccess,
  assertOrganizationAccess,
  departmentScopeWhere,
  organizationScopeWhere,
} from './department-access.util';

describe('assertDepartmentAccess', () => {
  it('never throws for ADMIN regardless of department', () => {
    expect(() =>
      assertDepartmentAccess(
        { id: 'u1', email: 'a', role: Role.ADMIN, departmentId: 'dept-a', organizationId: 'org-1' },
        'dept-b',
      ),
    ).not.toThrow();
  });

  it('never throws for SECURITY_ANALYST regardless of department', () => {
    expect(() =>
      assertDepartmentAccess(
        {
          id: 'u1',
          email: 'a',
          role: Role.SECURITY_ANALYST,
          departmentId: 'dept-a',
          organizationId: 'org-1',
        },
        'dept-b',
      ),
    ).not.toThrow();
  });

  it('allows an IT_TECHNICIAN when the resource department matches', () => {
    expect(() =>
      assertDepartmentAccess(
        {
          id: 'u1',
          email: 'a',
          role: Role.IT_TECHNICIAN,
          departmentId: 'dept-a',
          organizationId: 'org-1',
        },
        'dept-a',
      ),
    ).not.toThrow();
  });

  it('denies an IT_TECHNICIAN when the resource department differs', () => {
    expect(() =>
      assertDepartmentAccess(
        {
          id: 'u1',
          email: 'a',
          role: Role.IT_TECHNICIAN,
          departmentId: 'dept-a',
          organizationId: 'org-1',
        },
        'dept-b',
      ),
    ).toThrow(ForbiddenException);
  });

  it('fails closed for an IT_TECHNICIAN with no department against a departmented resource', () => {
    expect(() =>
      assertDepartmentAccess(
        { id: 'u1', email: 'a', role: Role.IT_TECHNICIAN, departmentId: null, organizationId: 'org-1' },
        'dept-a',
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows any role when the resource has no department to scope against', () => {
    expect(() =>
      assertDepartmentAccess(
        {
          id: 'u1',
          email: 'a',
          role: Role.IT_TECHNICIAN,
          departmentId: 'dept-a',
          organizationId: 'org-1',
        },
        null,
      ),
    ).not.toThrow();
  });
});

/**
 * Phase 1 RBAC/IDOR remediation — the collection-query equivalent of the
 * assertDepartmentAccess suite above. These pin down the exact `where`
 * fragment GET /ai/incidents, GET /ai/incidents/history, and GET /tickets
 * now apply (they previously applied none at all).
 */
describe('departmentScopeWhere', () => {
  it('returns undefined (no filter) for ADMIN', () => {
    expect(
      departmentScopeWhere({
        id: 'u1',
        email: 'a',
        role: Role.ADMIN,
        departmentId: null,
        organizationId: 'org-1',
      }),
    ).toBeUndefined();
  });

  it('returns undefined (no filter) for SECURITY_ANALYST', () => {
    expect(
      departmentScopeWhere({
        id: 'u1',
        email: 'a',
        role: Role.SECURITY_ANALYST,
        departmentId: 'dept-a',
        organizationId: 'org-1',
      }),
    ).toBeUndefined();
  });

  it('scopes an IT_TECHNICIAN to their own department plus undepartmented rows', () => {
    expect(
      departmentScopeWhere({
        id: 'u1',
        email: 'a',
        role: Role.IT_TECHNICIAN,
        departmentId: 'dept-a',
        organizationId: 'org-1',
      }),
    ).toEqual({ OR: [{ departmentId: 'dept-a' }, { departmentId: null }] });
  });

  it('fails closed to only undepartmented rows for an IT_TECHNICIAN with no department', () => {
    // Mirrors assertDepartmentAccess's fail-closed behavior for the same
    // case: a departmentless technician must not see every departmented
    // resource, only ones with no department to have been scoped to either.
    expect(
      departmentScopeWhere({
        id: 'u1',
        email: 'a',
        role: Role.IT_TECHNICIAN,
        departmentId: null,
        organizationId: 'org-1',
      }),
    ).toEqual({ OR: [{ departmentId: null }, { departmentId: null }] });
  });
});

/**
 * Phase 2.6B — the organization-level counterpart to the assertDepartmentAccess
 * suite above. Deliberately checks that EVERY role is scoped (unlike
 * department scoping, there is no ADMIN/SECURITY_ANALYST exemption), and
 * that a null resource organizationId is DENIED rather than allowed
 * through — the opposite of assertDepartmentAccess's own null-departmentId
 * exception, by explicit design (see department-access.util.ts's comment).
 */
describe('assertOrganizationAccess', () => {
  it('allows ADMIN when the resource organization matches', () => {
    expect(() =>
      assertOrganizationAccess(
        { id: 'u1', email: 'a', role: Role.ADMIN, departmentId: null, organizationId: 'org-a' },
        'org-a',
      ),
    ).not.toThrow();
  });

  it('denies ADMIN when the resource belongs to a different organization', () => {
    expect(() =>
      assertOrganizationAccess(
        { id: 'u1', email: 'a', role: Role.ADMIN, departmentId: null, organizationId: 'org-a' },
        'org-b',
      ),
    ).toThrow(ForbiddenException);
  });

  it('denies SECURITY_ANALYST when the resource belongs to a different organization', () => {
    expect(() =>
      assertOrganizationAccess(
        {
          id: 'u1',
          email: 'a',
          role: Role.SECURITY_ANALYST,
          departmentId: null,
          organizationId: 'org-a',
        },
        'org-b',
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows IT_TECHNICIAN when the resource organization matches', () => {
    expect(() =>
      assertOrganizationAccess(
        {
          id: 'u1',
          email: 'a',
          role: Role.IT_TECHNICIAN,
          departmentId: 'dept-a',
          organizationId: 'org-a',
        },
        'org-a',
      ),
    ).not.toThrow();
  });

  it('denies IT_TECHNICIAN when the resource belongs to a different organization', () => {
    expect(() =>
      assertOrganizationAccess(
        {
          id: 'u1',
          email: 'a',
          role: Role.IT_TECHNICIAN,
          departmentId: 'dept-a',
          organizationId: 'org-a',
        },
        'org-b',
      ),
    ).toThrow(ForbiddenException);
  });

  it('fails closed for a user not yet assigned to any organization, even against a resource with no organization', () => {
    expect(() =>
      assertOrganizationAccess(
        { id: 'u1', email: 'a', role: Role.ADMIN, departmentId: null, organizationId: null },
        null,
      ),
    ).toThrow(ForbiddenException);
  });

  it('denies access to a resource with no organization (never treated as belonging to every organization)', () => {
    expect(() =>
      assertOrganizationAccess(
        { id: 'u1', email: 'a', role: Role.ADMIN, departmentId: null, organizationId: 'org-a' },
        null,
      ),
    ).toThrow(ForbiddenException);
  });
});

describe('organizationScopeWhere', () => {
  it('scopes to the caller organization for ADMIN (no org-wide exemption)', () => {
    expect(
      organizationScopeWhere({
        id: 'u1',
        email: 'a',
        role: Role.ADMIN,
        departmentId: null,
        organizationId: 'org-a',
      }),
    ).toEqual({ organizationId: 'org-a' });
  });

  it('scopes to the caller organization for SECURITY_ANALYST (no org-wide exemption)', () => {
    expect(
      organizationScopeWhere({
        id: 'u1',
        email: 'a',
        role: Role.SECURITY_ANALYST,
        departmentId: null,
        organizationId: 'org-a',
      }),
    ).toEqual({ organizationId: 'org-a' });
  });

  it('scopes to the caller organization for IT_TECHNICIAN', () => {
    expect(
      organizationScopeWhere({
        id: 'u1',
        email: 'a',
        role: Role.IT_TECHNICIAN,
        departmentId: 'dept-a',
        organizationId: 'org-a',
      }),
    ).toEqual({ organizationId: 'org-a' });
  });

  it('fails closed to a guaranteed-empty sentinel for a user with no organization', () => {
    expect(
      organizationScopeWhere({
        id: 'u1',
        email: 'a',
        role: Role.ADMIN,
        departmentId: null,
        organizationId: null,
      }),
    ).toEqual({ organizationId: '__no_organization_assigned__' });
  });
});
