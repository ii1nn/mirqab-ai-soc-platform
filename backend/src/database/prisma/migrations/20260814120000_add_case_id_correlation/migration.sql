-- CreateTable
CREATE TABLE "case_counters" (
    "dateKey" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "case_counters_pkey" PRIMARY KEY ("dateKey")
);

-- CreateTable
CREATE TABLE "incident_evidence" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "sourceExcerpt" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "mitreTechniqueId" TEXT NOT NULL,
    "mitreTechniqueName" TEXT NOT NULL,
    "mitreTactic" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "iocs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "correlationScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incident_evidence_incidentId_idx" ON "incident_evidence"("incidentId");

-- AddForeignKey
ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (nullable first — backfilled below, then locked down to NOT NULL)
ALTER TABLE "incidents" ADD COLUMN "caseId" TEXT;
ALTER TABLE "incidents" ADD COLUMN "lastEvidenceAt" TIMESTAMP(3);

-- Backfill lastEvidenceAt for any pre-existing incidents
UPDATE "incidents" SET "lastEvidenceAt" = "createdAt" WHERE "lastEvidenceAt" IS NULL;

-- Backfill caseId deterministically: "INC-YYYYMMDD-NNNN", sequenced by
-- createdAt within each calendar day, so pre-existing rows get the same
-- format new ingestion will use going forward.
WITH ordered AS (
  SELECT "id",
         to_char("createdAt", 'YYYYMMDD') AS date_key,
         ROW_NUMBER() OVER (PARTITION BY to_char("createdAt", 'YYYYMMDD') ORDER BY "createdAt") AS seq
  FROM "incidents"
)
UPDATE "incidents" i
SET "caseId" = 'INC-' || o.date_key || '-' || lpad(o.seq::text, 4, '0')
FROM ordered o
WHERE i."id" = o."id";

-- Backfill one founding evidence row per pre-existing incident, copying its
-- current classification so no history is lost. md5(random()::text || id)
-- cast to uuid is a standard extension-free way to generate a random id
-- (Postgres accepts a 32-hex-digit string as uuid input without dashes).
INSERT INTO "incident_evidence"
  ("id", "incidentId", "sourceExcerpt", "severity", "mitreTechniqueId", "mitreTechniqueName", "mitreTactic", "generatedBy", "iocs", "correlationScore", "createdAt")
SELECT md5(random()::text || i."id")::uuid::text,
       i."id",
       i."sourceExcerpt",
       i."severity",
       i."mitreTechniqueId",
       i."mitreTechniqueName",
       i."mitreTactic",
       i."generatedBy",
       i."iocs",
       NULL,
       i."createdAt"
FROM "incidents" i;

-- Seed case_counters so future ingestion continues each day's sequence
-- correctly instead of restarting at 1 and colliding with backfilled rows.
INSERT INTO "case_counters" ("dateKey", "lastSeq")
SELECT to_char("createdAt", 'YYYYMMDD'), COUNT(*)
FROM "incidents"
GROUP BY to_char("createdAt", 'YYYYMMDD');

-- Now that every row has a value, enforce the real constraints.
ALTER TABLE "incidents" ALTER COLUMN "lastEvidenceAt" SET NOT NULL;
ALTER TABLE "incidents" ALTER COLUMN "lastEvidenceAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "incidents" ALTER COLUMN "caseId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "incidents_caseId_key" ON "incidents"("caseId");
