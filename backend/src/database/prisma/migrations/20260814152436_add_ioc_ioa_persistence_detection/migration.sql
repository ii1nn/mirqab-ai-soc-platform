-- CreateEnum
CREATE TYPE "IndicatorCategory" AS ENUM ('IOC', 'IOA');

-- CreateEnum
CREATE TYPE "IndicatorType" AS ENUM ('IP', 'DOMAIN', 'URL', 'HASH', 'EMAIL', 'FILE_PATH', 'REGISTRY_KEY', 'MUTEX', 'USER_ACCOUNT', 'BEHAVIOR');

-- CreateEnum
CREATE TYPE "PersistenceType" AS ENUM ('SCHEDULED_TASK', 'WINDOWS_SERVICE', 'STARTUP_FOLDER', 'REGISTRY_RUN_KEY', 'WMI_SUBSCRIPTION', 'LOGIN_SCRIPT', 'CRON_JOB', 'POWERSHELL_PROFILE', 'ACCOUNT_CREDENTIAL_CHANGE', 'OTHER');

-- CreateTable
CREATE TABLE "indicators" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "evidenceId" TEXT,
    "category" "IndicatorCategory" NOT NULL,
    "type" "IndicatorType" NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "subtype" TEXT,
    "mitreTechniqueId" TEXT,
    "confidence" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persistence_findings" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "evidenceId" TEXT,
    "type" "PersistenceType" NOT NULL,
    "endpoint" TEXT,
    "userAccount" TEXT,
    "process" TEXT,
    "command" TEXT,
    "evidenceText" TEXT NOT NULL,
    "mitreTechniqueId" TEXT NOT NULL,
    "mitreTechniqueName" TEXT NOT NULL,
    "mitreTactic" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "risk" "Severity" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persistence_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "indicators_incidentId_idx" ON "indicators"("incidentId");

-- CreateIndex
CREATE INDEX "indicators_value_idx" ON "indicators"("value");

-- CreateIndex
CREATE INDEX "indicators_subtype_idx" ON "indicators"("subtype");

-- CreateIndex
CREATE INDEX "persistence_findings_incidentId_idx" ON "persistence_findings"("incidentId");

-- AddForeignKey
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "incident_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persistence_findings" ADD CONSTRAINT "persistence_findings_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persistence_findings" ADD CONSTRAINT "persistence_findings_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "incident_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
