-- AlterEnum
ALTER TYPE "IncidentStatus" ADD VALUE 'INVESTIGATING';
ALTER TYPE "IncidentStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "rootCause" TEXT,
ADD COLUMN     "finalResolution" TEXT,
ADD COLUMN     "lessonsLearned" TEXT;

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "deviceType" TEXT NOT NULL DEFAULT 'workstation';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "ticketNumber" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticketNumber_key" ON "tickets"("ticketNumber");
