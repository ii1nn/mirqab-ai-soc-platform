-- Phase 2.6A: multi-tenant foundation, step 1 of 2 (nullable rollout).
-- Adds the Organization table and a nullable organizationId column to every
-- resource that will become organization-scoped. Nullable is deliberate —
-- see the follow-up migration (enforce_organization_not_null) for the
-- backfill + NOT NULL enforcement step. This keeps the two structurally
-- different kinds of change (additive vs. constraint-tightening) isolated,
-- per the project's own established migration discipline.
--
-- NOTE: this migration intentionally does NOT touch "incidents"."isSimulated"
-- or its index. A pre-existing drift was discovered while preparing this
-- migration: the live database has an applied migration
-- (20260819064620_add_incident_is_simulated) whose migration directory no
-- longer exists on disk, and schema.prisma has no "isSimulated" field —
-- meaning the database and the tracked schema/migration history already
-- disagree, independent of and prior to this phase's work. That
-- inconsistency is out of scope here and is reported separately rather than
-- silently resolved by this migration.

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- AlterTable: departments (drop the old bare-name uniqueness; the
-- org-scoped composite uniqueness is added in the follow-up migration once
-- organizationId is backfilled and non-null)
DROP INDEX "departments_name_key";
ALTER TABLE "departments" ADD COLUMN "organizationId" TEXT;

-- AlterTable: users
ALTER TABLE "users" ADD COLUMN "organizationId" TEXT;

-- AlterTable: devices
ALTER TABLE "devices" ADD COLUMN "organizationId" TEXT;

-- AlterTable: incidents
ALTER TABLE "incidents" ADD COLUMN "organizationId" TEXT;

-- AlterTable: tickets
ALTER TABLE "tickets" ADD COLUMN "organizationId" TEXT;

-- AlterTable: audit_logs
ALTER TABLE "audit_logs" ADD COLUMN "organizationId" TEXT;

-- AlterTable: weekly_reports
ALTER TABLE "weekly_reports" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");
CREATE INDEX "devices_organizationId_idx" ON "devices"("organizationId");
CREATE INDEX "incidents_organizationId_idx" ON "incidents"("organizationId");
CREATE INDEX "tickets_organizationId_idx" ON "tickets"("organizationId");
CREATE INDEX "audit_logs_organizationId_idx" ON "audit_logs"("organizationId");
CREATE INDEX "weekly_reports_organizationId_idx" ON "weekly_reports"("organizationId");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data backfill (same transaction as the schema change above, for
-- atomicity — either both succeed or neither does).
--
-- Baseline established before writing this migration: 5 users, 5
-- departments, 431 incidents, 15 devices, 177 tickets, 467 audit logs, 0
-- weekly reports — all unambiguously one single test organization (one
-- ADMIN account, department names matching the seed script, test accounts
-- from prior phases' own live testing). No cross-company signal of any
-- kind exists in this data, so backfilling everything to one default
-- organization is safe and unambiguous, not a guess.
--
-- Departments, Devices, and Users are backfilled unconditionally — every
-- existing row in all three tables belongs to the one default org, with no
-- exceptions (see the Users backfill's own comment below for a correction
-- made to this migration before it was applied). Incidents, Tickets, and
-- AuditLogs are instead backfilled via their real ownership chain
-- (department / acting user) rather than a blanket UPDATE, so a genuinely
-- org-less row (e.g. an incident from an unresolved device, or a
-- system-actor audit entry) stays honestly null instead of being forced
-- into the default org.

INSERT INTO "organizations" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default-organization', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE "departments" SET "organizationId" = '00000000-0000-0000-0000-000000000001';

UPDATE "devices" SET "organizationId" = '00000000-0000-0000-0000-000000000001';

-- Users: backfilled unconditionally, same as departments/devices above.
-- Baseline confirmed all 5 existing users (including an IT_TECHNICIAN with
-- no department assigned) belong to the one single test organization, with
-- zero ambiguity — there is no signal anywhere in this dataset suggesting
-- more than one company. An earlier draft of this migration used a
-- conditional WHERE clause here (departmentId IS NOT NULL OR role IN
-- ('ADMIN','SECURITY_ANALYST') OR role = 'EMPLOYEE') intended to mirror
-- User.organizationId's deliberate nullable-by-design status for *future*
-- self-signup accounts that haven't chosen an org yet — but that reasoning
-- doesn't apply to *existing* rows, and the conditional incorrectly missed
-- the one existing department-less IT_TECHNICIAN, who would have been left
-- with organizationId = NULL despite unambiguously belonging to this same
-- default org. Corrected to an unconditional UPDATE so every existing user
-- is actually backfilled, exactly as the baseline established. The
-- nullable-column design for future self-signups is unaffected — it's a
-- property of new rows created after this migration, not of the ones
-- already in the table today.
UPDATE "users" SET "organizationId" = '00000000-0000-0000-0000-000000000001';

-- Incidents/Tickets: backfilled from their own department's organization,
-- not blanket-assigned — a department-less incident (device unresolved at
-- ingestion) stays organizationId = NULL, honestly matching its existing
-- departmentId = NULL state, rather than being guessed into an org.
UPDATE "incidents" i SET "organizationId" = d."organizationId"
FROM "departments" d
WHERE i."departmentId" = d."id";

UPDATE "tickets" t SET "organizationId" = d."organizationId"
FROM "departments" d
WHERE t."departmentId" = d."id";

-- AuditLogs: backfilled from the acting user's own organization (matches
-- AuditLogsService.log()'s runtime resolution logic going forward — see
-- that service). A synthetic "system:*" actor (no matching User row) stays
-- organizationId = NULL, same reasoning as above.
UPDATE "audit_logs" al SET "organizationId" = u."organizationId"
FROM "users" u
WHERE al."actorEmail" = u."email";

