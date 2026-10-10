import { Role } from '@prisma/client';

/**
 * Shape of `request.user` once a request has passed JwtAuthGuard.
 * Deliberately excludes anything beyond what route handlers need for
 * authorization decisions — never the password hash or full user record.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  /** Null = org-wide access. See common/guards/incident-access.guard.ts. */
  departmentId: string | null;
  /**
   * Phase 2.6B. Resolved live from the database on every request (see
   * JwtStrategy.validate()) — never trusted from the JWT payload itself,
   * same rule as role/departmentId. Null means this account has not been
   * assigned to an organization yet (e.g. a self-signup account pending
   * both admin approval and organization assignment — see
   * User.organizationId's schema comment). A null organizationId is
   * fail-closed everywhere: see assertOrganizationAccess/
   * organizationScopeWhere in common/guards/department-access.util.ts.
   */
  organizationId: string | null;
}
