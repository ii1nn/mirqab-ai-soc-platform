import { Injectable } from '@nestjs/common';
import { AiAgentName } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface AgentDecisionInput {
  incidentId: string;
  agent: AiAgentName;
  action: string;
  /** The AiProvider.providerId that produced this decision (e.g.
   * 'self-hosted', 'claude-dev-only'), 'rule-based-fallback', or
   * 'deterministic' for the non-AI detection/correlation/risk engines.
   * Phase 8: widened from a fixed union so a future provider is never
   * mislabeled. */
  generatedBy: string;
  confidence?: number;
  evidenceRefs?: string[];
  summary: string;
}

/**
 * Requirement #29's audit trail: every agent decision (see
 * agents/agent-permissions.ts) gets one row here — which agent, what it did,
 * how it was generated, its confidence, and references back to the
 * evidence/indicator/finding rows that informed it. Read-only for callers
 * beyond this write; nothing here grants an agent any capability, it only
 * records what happened.
 */
@Injectable()
export class AgentAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AgentDecisionInput): Promise<void> {
    await this.prisma.aiAgentDecision.create({
      data: {
        incidentId: input.incidentId,
        agent: input.agent,
        action: input.action,
        generatedBy: input.generatedBy,
        confidence: input.confidence,
        evidenceRefs: input.evidenceRefs ?? [],
        summary: input.summary,
      },
    });
  }

  async listForIncident(incidentId: string) {
    return this.prisma.aiAgentDecision.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
