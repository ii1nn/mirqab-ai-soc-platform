-- CreateEnum
CREATE TYPE "AiAgentName" AS ENUM ('INCIDENT_AGENT', 'IOC_IOA_AGENT', 'MITRE_RISK_AGENT', 'RECOMMENDATION_AGENT');

-- CreateTable
CREATE TABLE "ai_agent_decisions" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "agent" "AiAgentName" NOT NULL,
    "action" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "confidence" INTEGER,
    "evidenceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_agent_decisions_incidentId_idx" ON "ai_agent_decisions"("incidentId");

-- AddForeignKey
ALTER TABLE "ai_agent_decisions" ADD CONSTRAINT "ai_agent_decisions_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
