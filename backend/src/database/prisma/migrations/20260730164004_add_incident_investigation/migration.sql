-- CreateEnum
CREATE TYPE "IncidentActionType" AS ENUM ('ISOLATE_DEVICE', 'DISABLE_ACCOUNT', 'BLOCK_IP', 'BLOCK_HASH', 'RESET_PASSWORD', 'UPDATE_FIREWALL', 'KILL_PROCESS', 'REMOVE_MALWARE', 'COLLECT_FORENSICS', 'MONITOR_DEPARTMENT');

-- CreateEnum
CREATE TYPE "IncidentActionOutcome" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "destinationAsset" TEXT,
ADD COLUMN     "detectionRule" TEXT,
ADD COLUMN     "iocs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "malwareFamily" TEXT,
ADD COLUMN     "sourceCountry" TEXT,
ADD COLUMN     "sourceIp" TEXT,
ADD COLUMN     "userAccount" TEXT;

-- CreateTable
CREATE TABLE "incident_actions" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "type" "IncidentActionType" NOT NULL,
    "outcome" "IncidentActionOutcome" NOT NULL DEFAULT 'PENDING',
    "performedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incident_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incident_actions_incidentId_idx" ON "incident_actions"("incidentId");

-- AddForeignKey
ALTER TABLE "incident_actions" ADD CONSTRAINT "incident_actions_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
