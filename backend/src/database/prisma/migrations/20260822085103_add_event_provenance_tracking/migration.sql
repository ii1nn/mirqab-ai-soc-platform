-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('LIVE_AGENT', 'OPEN_SOURCE_DATASET', 'SIMULATION', 'MANUAL_TEST');

-- AlterTable
ALTER TABLE "incident_evidence" ADD COLUMN     "datasetOrigin" TEXT,
ADD COLUMN     "ingestSource" "EventSource" NOT NULL DEFAULT 'MANUAL_TEST',
ADD COLUMN     "rawEvent" TEXT;

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "datasetOrigin" TEXT,
ADD COLUMN     "ingestSource" "EventSource" NOT NULL DEFAULT 'MANUAL_TEST',
ADD COLUMN     "rawEvent" TEXT;
