import { Injectable } from '@nestjs/common';
import { Incident } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { departmentScopeWhere, organizationScopeWhere } from '../../../common/guards/department-access.util';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { cosineSimilarity, embedText } from './vector.util';

export interface SimilarIncident {
  incident: Incident;
  score: number;
}

/**
 * Exact nearest-neighbor search over incident embeddings — behaviorally
 * equivalent to a FAISS `IndexFlatIP` (brute-force inner-product search on
 * normalized vectors), implemented natively so the backend doesn't need a
 * fragile native FAISS binary. Adequate for a SOC's incident volume
 * (thousands, not billions, of rows); swap in a real FAISS index behind
 * this same interface if the corpus outgrows brute-force scanning.
 */
@Injectable()
export class SimilarityEngineService {
  constructor(private readonly prisma: PrismaService) {}

  private buildDigest(
    incident: Pick<Incident, 'title' | 'description' | 'mitreTechniqueName' | 'severity'>,
  ): string {
    return `${incident.title} ${incident.description} ${incident.mitreTechniqueName} ${incident.severity}`;
  }

  async indexIncident(incidentId: string): Promise<void> {
    const incident = await this.prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
    const textDigest = this.buildDigest(incident);
    const vector = embedText(textDigest);

    await this.prisma.incidentMemory.upsert({
      where: { incidentId },
      create: { incidentId, vector, textDigest },
      update: { vector, textDigest },
    });
  }

  async findSimilar(
    incidentId: string,
    user: AuthenticatedUser,
    limit = 5,
  ): Promise<SimilarIncident[]> {
    const target = await this.prisma.incidentMemory.findUnique({ where: { incidentId } });
    if (!target) return [];

    // Phase 16 (performance/scale review): previously scanned every
    // IncidentMemory row (and its full joined Incident) in the entire
    // database, with no department filter and no row cap — the same
    // cross-department leak + unbounded-scan issue fixed in
    // AiService.getInvestigation right above this call site's sibling
    // method. `IncidentMemory` has no departmentId column of its own
    // (see schema.prisma), so the scope is applied through the `incident`
    // relation it's joined to. `take` bounds the comparison pool the same
    // way every other collection query in this codebase caps at 200.
    //
    // Phase 2.6B: organizationScopeWhere() applied through the same
    // `incident` relation — a null-org incident's memory row is excluded
    // (strict equality, no null-inclusive OR), never treated as visible
    // org-wide.
    const deptScope = departmentScopeWhere(user);
    const candidates = await this.prisma.incidentMemory.findMany({
      where: {
        incidentId: { not: incidentId },
        incident: {
          ...(deptScope ? { OR: deptScope.OR } : {}),
          ...organizationScopeWhere(user),
        },
      },
      include: { incident: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return candidates
      .map((candidate) => ({
        incident: candidate.incident,
        score: cosineSimilarity(target.vector, candidate.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
