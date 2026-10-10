-- Phase 2.6A: multi-tenant foundation, step 2 of 2 (constraint enforcement).
-- Runs only after Migration 1 (20260908235500_add_organization_foundation)
-- was applied and its backfill verified at 0 NULLs for
-- departments/devices/users. Every statement below was reviewed and
-- explicitly approved before this file was written.
--
-- Does NOT touch "incidents"."isSimulated" (pre-existing, unrelated schema
-- drift — reported separately, not resolved here). Does NOT modify
-- Migration 1. Contains no DELETE, DROP TABLE, DROP COLUMN, or TRUNCATE.

-- Statement 1: narrow, verified audit_log backfill. `target` is confirmed
-- by direct code inspection (ai.service.ts:428 for
-- 'system:correlation-engine'; AiService.createIncidentAction() for
-- 'system:auto-response-policy', both already-read call sites) to always be
-- a real Incident id for these two specific system actors — never a
-- device/ticket/user/policy id, which `target` can otherwise hold elsewhere
-- in this table. Explicit actorEmail restriction kept for defense-in-depth
-- even though it changes nothing numerically (verified: 167 rows either
-- way, with or without this restriction, against live data). Expected
-- result: 167 rows updated; 19 rows remain permanently NULL (13
-- 'system:correlation-engine' rows whose target incident is itself still
-- org-less, plus 5 'throttle-test@mirqab.local' + 1
-- 'nobody-31878@mirqab.local' synthetic non-existent-account rows from
-- earlier phases' own security testing, with no target to derive from) —
-- not guessed, left honestly NULL.
UPDATE "audit_logs" al
SET "organizationId" = i."organizationId"
FROM "incidents" i
WHERE al.target = i.id
  AND al."organizationId" IS NULL
  AND i."organizationId" IS NOT NULL
  AND al."actorEmail" IN ('system:auto-response-policy', 'system:correlation-engine');

-- Statement 2: enforce NOT NULL on departments (0 NULL rows, FK validated —
-- verified immediately before this file was written). 0 rows changed —
-- constraint-only, writes no data.
ALTER TABLE "departments"
ALTER COLUMN "organizationId" SET NOT NULL;

-- Statement 3: enforce NOT NULL on devices (0 NULL rows, FK validated —
-- verified). 0 rows changed — constraint-only, writes no data.
ALTER TABLE "devices"
ALTER COLUMN "organizationId" SET NOT NULL;

-- Statement 4: restore department-name uniqueness, now company-scoped
-- instead of global (0 existing duplicate (organizationId, name) pairs —
-- verified). 0 rows changed — index creation only, writes no data.
CREATE UNIQUE INDEX "departments_organizationId_name_key" ON "departments"("organizationId", "name");

-- Deliberately NOT included, by design (see Phase 2.5/2.6A architecture
-- review): users.organizationId, incidents.organizationId,
-- tickets.organizationId, and audit_logs.organizationId all remain
-- nullable — no NOT NULL constraint is added to any of them here.
