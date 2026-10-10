-- =====================================================================
-- Reconcile legacy persistence_findings / weekly_reports with schema.prisma
--
-- Background: on databases that ran the older, since-renamed migrations
-- 20260811/12/13, the migrations 20260814120000, 20260814152436 and
-- 20260814232431 could only be marked applied (0 steps executed), because
-- those objects already existed in their earlier shape. This migration
-- brings such a LEGACY database up to the current schema WITHOUT removing
-- any existing column, row or table.
--
-- On a CLEAN install the repo's own migrations already create the current
-- shape, so this migration detects that and changes nothing.
--
--   legacy shape  ("evidence" present, "evidenceText" absent) -> reconcile
--   current shape ("evidenceText" present, "evidence" absent)  -> no-op
--   anything else                                              -> abort
--
-- Additive only: no DROP TABLE / DROP COLUMN / TRUNCATE / DELETE.
-- Runs as a single transaction; any failed check aborts with no changes.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  has_legacy  boolean;
  has_current boolean;
  n           integer;
  unmapped    text;
  pf_rows     bigint;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'persistence_findings'
                   AND column_name = 'evidence')
    INTO has_legacy;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'persistence_findings'
                   AND column_name = 'evidenceText')
    INTO has_current;

  IF has_current AND NOT has_legacy THEN
    RAISE NOTICE 'persistence_findings already has the current shape - nothing to reconcile';

  ELSIF has_legacy AND NOT has_current THEN
    -- -----------------------------------------------------------------
    -- 0. PRE-FLIGHT SAFETY CHECKS (legacy databases only)
    -- -----------------------------------------------------------------
    -- 0a. none of the other new-shape columns may exist yet
    SELECT count(*) INTO n FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'persistence_findings'
      AND column_name IN ('evidenceId', 'endpoint', 'userAccount', 'command');
    IF n > 0 THEN
      RAISE EXCEPTION 'persistence_findings is partially reconciled (% new-shape column(s)) - aborting', n;
    END IF;

    -- 0b. the enum must be used by exactly one column (persistence_findings.type)
    SELECT count(*) INTO n FROM information_schema.columns
    WHERE udt_schema = current_schema() AND udt_name = 'PersistenceType';
    IF n <> 1 THEN
      RAISE EXCEPTION 'PersistenceType is used by % columns (expected 1) - aborting', n;
    END IF;

    -- 0c. temporary/legacy type names must be free
    IF EXISTS (SELECT 1 FROM pg_type
               WHERE typname IN ('PersistenceType_new', 'PersistenceType_legacy')) THEN
      RAISE EXCEPTION 'PersistenceType_new or PersistenceType_legacy already exists - aborting';
    END IF;

    -- 0d. every existing type value must have an explicit mapping (no silent 'OTHER')
    SELECT string_agg(DISTINCT "type"::text, ', ') INTO unmapped
    FROM "persistence_findings"
    WHERE "type"::text NOT IN (
      'SCHEDULED_TASK', 'WINDOWS_SERVICE', 'STARTUP_FOLDER', 'REGISTRY_RUN_KEY',
      'CRON_JOB', 'LOGIN_SCRIPT', 'WMI_SUBSCRIPTION',
      'POWERSHELL_PERSISTENCE', 'ACCOUNT_CHANGE');
    IF unmapped IS NOT NULL THEN
      RAISE EXCEPTION 'Unmapped PersistenceType value(s): % - aborting', unmapped;
    END IF;

    SELECT count(*) INTO pf_rows FROM "persistence_findings";

    -- -----------------------------------------------------------------
    -- 1. ADD the new-shape columns (nullable first)
    -- -----------------------------------------------------------------
    ALTER TABLE "persistence_findings"
      ADD COLUMN "evidenceId"   TEXT,
      ADD COLUMN "endpoint"     TEXT,
      ADD COLUMN "userAccount"  TEXT,
      ADD COLUMN "command"      TEXT,
      ADD COLUMN "evidenceText" TEXT;

    -- -----------------------------------------------------------------
    -- 2. COPY data from legacy columns into the new ones (legacy kept)
    -- -----------------------------------------------------------------
    UPDATE "persistence_findings"
    SET "endpoint"     = "hostname",
        "userAccount"  = "username",
        "command"      = "commandLine",
        "evidenceText" = "evidence";
    -- "evidenceId" stays NULL: legacy rows linked to alerts("alertId"), and
    -- there is no reliable mapping from a legacy alert to incident_evidence.

    ALTER TABLE "persistence_findings" ALTER COLUMN "evidenceText" SET NOT NULL;

    -- Legacy "evidence" is NOT NULL with no default; current code no longer
    -- writes it, so give it a default instead of relaxing the constraint.
    ALTER TABLE "persistence_findings" ALTER COLUMN "evidence" SET DEFAULT '';

    -- -----------------------------------------------------------------
    -- 3. ENUM: recreate-and-swap (the old type is RENAMED, not dropped)
    -- -----------------------------------------------------------------
    CREATE TYPE "PersistenceType_new" AS ENUM (
      'SCHEDULED_TASK', 'WINDOWS_SERVICE', 'STARTUP_FOLDER', 'REGISTRY_RUN_KEY',
      'WMI_SUBSCRIPTION', 'LOGIN_SCRIPT', 'CRON_JOB', 'POWERSHELL_PROFILE',
      'ACCOUNT_CREDENTIAL_CHANGE', 'OTHER');

    ALTER TABLE "persistence_findings"
      ALTER COLUMN "type" TYPE "PersistenceType_new"
      USING (CASE "type"::text
               WHEN 'POWERSHELL_PERSISTENCE' THEN 'POWERSHELL_PROFILE'
               WHEN 'ACCOUNT_CHANGE'         THEN 'ACCOUNT_CREDENTIAL_CHANGE'
               ELSE "type"::text
             END)::"PersistenceType_new";

    ALTER TYPE "PersistenceType"     RENAME TO "PersistenceType_legacy";
    ALTER TYPE "PersistenceType_new" RENAME TO "PersistenceType";

    -- -----------------------------------------------------------------
    -- 4. FOREIGN KEY evidenceId -> incident_evidence (matches repo migration)
    -- -----------------------------------------------------------------
    ALTER TABLE "persistence_findings"
      ADD CONSTRAINT "persistence_findings_evidenceId_fkey"
      FOREIGN KEY ("evidenceId") REFERENCES "incident_evidence"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;

    -- -----------------------------------------------------------------
    -- 5. POST-CHECKS (abort + roll back everything if any fail)
    -- -----------------------------------------------------------------
    IF (SELECT count(*) FROM "persistence_findings") <> pf_rows THEN
      RAISE EXCEPTION 'persistence_findings row count changed - rolling back';
    END IF;

    SELECT count(*) INTO n FROM "persistence_findings"
    WHERE "evidenceText" IS DISTINCT FROM "evidence"
       OR "endpoint"     IS DISTINCT FROM "hostname"
       OR "userAccount"  IS DISTINCT FROM "username"
       OR "command"      IS DISTINCT FROM "commandLine";
    IF n > 0 THEN
      RAISE EXCEPTION '% row(s) failed the legacy->new copy check - rolling back', n;
    END IF;

    IF (SELECT udt_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'persistence_findings'
          AND column_name = 'type') <> 'PersistenceType'
       OR (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'PersistenceType') <> 10 THEN
      RAISE EXCEPTION 'PersistenceType swap did not complete as expected - rolling back';
    END IF;

  ELSE
    RAISE EXCEPTION 'persistence_findings is in an unexpected shape (legacy=%, current=%) - aborting',
      has_legacy, has_current;
  END IF;

  -- -------------------------------------------------------------------
  -- 6. weekly_reports: legacy NOT NULL columns get a default (current
  --    code doesn't write them). Absent on clean installs - skipped.
  -- -------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'weekly_reports'
               AND column_name = 'totalAlerts') THEN
    ALTER TABLE "weekly_reports" ALTER COLUMN "totalAlerts" SET DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'weekly_reports'
               AND column_name = 'totalIncidents') THEN
    ALTER TABLE "weekly_reports" ALTER COLUMN "totalIncidents" SET DEFAULT 0;
  END IF;
END $$;

COMMIT;
