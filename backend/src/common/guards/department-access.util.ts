import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Shared authorization decision behind IncidentAccessGuard/TicketAccessGuard
 * (requirement #30, OWASP API#1). Kept as one function so the fail-closed
 * rule (an IT_TECHNICIAN with no department gets denied, not granted
 * everything) only needs to be correct in one place.
 */
export function assertDepartmentAccess(
  user: AuthenticatedUser,
  resourceDepartmentId: string | null | undefined,
): void {
  if (user.role !== Role.IT_TECHNICIAN) {
    return;
  }
  if (!resourceDepartmentId) {
    // Nothing to scope against — an undepartmented resource (e.g. an
    // incident whose device couldn't be resolved at ingestion) isn't
    // gated by this check.
    return;
  }
  if (resourceDepartmentId !== user.departmentId) {
    throw new ForbiddenException('You do not have access to this resource.');
  }
}

/**
 * Phase 1 RBAC/IDOR remediation: the collection-query equivalent of
 * assertDepartmentAccess. The object-level guards above only ever ran on
 * routes with an `:id` param — by their own design, list/collection routes
 * (`GET /ai/incidents`, `GET /ai/incidents/history`, `GET /tickets`) were
 * never scoped at all, so any authenticated IT_TECHNICIAN could read every
 * department's data through those endpoints. This returns the Prisma
 * `where` fragment that applies the exact same access rule as
 * assertDepartmentAccess to a `findMany` instead of a post-hoc check on one
 * already-fetched row:
 *
 * - ADMIN/SECURITY_ANALYST: `undefined` — no filter, org-wide, matching
 *   their existing no-op in assertDepartmentAccess.
 * - IT_TECHNICIAN: only their own department's rows, plus undepartmented
 *   ones (`departmentId: null`) — the same "nothing to scope against"
 *   exception assertDepartmentAccess grants. If the technician has no
 *   department themselves, `user.departmentId` is null and both OR
 *   branches collapse to `departmentId: null`, which fails closed to only
 *   undepartmented rows — never silently to "everything", matching
 *   assertDepartmentAccess's fail-closed behavior for the same case.
 *
 * Callers still pass this straight into `findMany({ where })` — never
 * merge in an unvalidated client-supplied departmentId alongside it (see
 * DevicesService.findAll, which validates any client-supplied departmentId
 * through assertDepartmentAccess before using it instead of this filter).
 */
export function departmentScopeWhere(
  user: AuthenticatedUser,
): { OR: { departmentId: string | null }[] } | undefined {
  if (user.role !== Role.IT_TECHNICIAN) {
    return undefined;
  }
  return { OR: [{ departmentId: user.departmentId }, { departmentId: null }] };
}

/**
 * Phase 2.6B — the organization-level counterpart to assertDepartmentAccess.
 * Deliberately stricter than its department equivalent in two ways:
 *
 * 1. No role-based exemption: an ADMIN/SECURITY_ANALYST's existing
 *    "org-wide" access always meant "org-wide within the single tenant
 *    this app assumed" — under multi-tenancy that narrows to "org-wide
 *    within their own organization", so every role is checked, no
 *    exception.
 * 2. A null resourceOrganizationId is DENIED, not allowed. This differs
 *    from assertDepartmentAccess's own null-departmentId exception (which
 *    stays exactly as-is, unchanged, for the department dimension). A
 *    null-org resource (e.g. an incident whose device never resolved at
 *    ingestion — see AiService.analyzeLog) has no established ownership,
 *    and per this phase's explicit design decision it must never be
 *    treated as "belonging to every organization" by omission — these
 *    genuinely ownerless rows are excluded from normal tenant-scoped
 *    access entirely (both list and direct-by-id) until a real ownership-
 *    assignment mechanism exists (future work, not built here). A null
 *    user.organizationId fails closed first, before this check even runs.
 */
export function assertOrganizationAccess(
  user: AuthenticatedUser,
  resourceOrganizationId: string | null | undefined,
): void {
  if (!user.organizationId) {
    throw new ForbiddenException('Your account is not yet assigned to an organization.');
  }
  if (!resourceOrganizationId) {
    throw new ForbiddenException('This resource has no assigned organization and cannot be accessed.');
  }
  if (resourceOrganizationId !== user.organizationId) {
    throw new ForbiddenException('You do not have access to this resource.');
  }
}

/**
 * Phase 2.6B — the organization-level counterpart to departmentScopeWhere,
 * for `findMany`-shaped queries. Every role is scoped (no ADMIN/
 * SECURITY_ANALYST exemption). Strict equality only — deliberately does
 * NOT include an `OR: [{organizationId: null}]` branch the way
 * departmentScopeWhere includes `{departmentId: null}`: a null-org row has
 * no established ownership and must not surface in a normal tenant-scoped
 * list (see assertOrganizationAccess's comment for the full reasoning).
 *
 * A null user.organizationId returns a guaranteed-empty-result sentinel
 * (mirrors the existing `'__no_department_assigned__'` pattern already
 * used in DevicesService.resolveListScope for a non-nullable column).
 */
export function organizationScopeWhere(user: AuthenticatedUser): { organizationId: string } {
  return { organizationId: user.organizationId ?? '__no_organization_assigned__' };
}
