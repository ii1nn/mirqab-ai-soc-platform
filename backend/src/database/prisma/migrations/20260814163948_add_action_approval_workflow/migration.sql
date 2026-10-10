-- CreateEnum
CREATE TYPE "ActionApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "incident_actions" ADD COLUMN     "approvalStatus" "ActionApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "requestedBy" TEXT;
