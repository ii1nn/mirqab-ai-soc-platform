import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { SimilarityEngineService } from './similarity-engine.service';

/**
 * Phase 16 (performance/scale review): `findSimilar()` previously scanned
 * every `IncidentMemory` row (and its full joined `Incident`) in the entire
 * database, with no department filter and no row cap — the same
 * cross-department leak + unbounded-scan bug fixed in `AiService.
 * getInvestigation` (see ai.service.spec.ts's own Phase 16 block). This
 * file didn't exist before this phase — the code path had no test coverage
 * at all, which is very likely why the gap went unnoticed through every
 * prior RBAC-focused phase.
 */
describe('SimilarityEngineService', () => {
  let service: SimilarityEngineService;
  let prisma: {
    incidentMemory: Record<'findUnique' | 'findMany' | 'upsert', jest.Mock>;
  };

  const itTechnician: AuthenticatedUser = {
    id: 'tech-1',
    email: 'tech@mirqab.local',
    role: Role.IT_TECHNICIAN,
    departmentId: 'dept-a',
    organizationId: 'org-1',
  };
  const admin: AuthenticatedUser = {
    id: 'admin-1',
    email: 'admin@mirqab.local',
    role: Role.ADMIN,
    departmentId: null,
    organizationId: 'org-1',
  };

  beforeEach(async () => {
    prisma = {
      incidentMemory: {
        findUnique: jest.fn().mockResolvedValue({ incidentId: 'incident-1', vector: [1, 0, 0] }),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [SimilarityEngineService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(SimilarityEngineService);
  });

  it('returns [] without querying candidates when the target incident has no indexed memory', async () => {
    prisma.incidentMemory.findUnique.mockResolvedValue(null);

    const result = await service.findSimilar('incident-1', admin);

    expect(result).toEqual([]);
    expect(prisma.incidentMemory.findMany).not.toHaveBeenCalled();
  });

  it("scopes the candidate query to the caller's own department and organization for IT_TECHNICIAN, via the incident relation", async () => {
    await service.findSimilar('incident-1', itTechnician);

    expect(prisma.incidentMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          incidentId: { not: 'incident-1' },
          incident: {
            OR: [{ departmentId: 'dept-a' }, { departmentId: null }],
            organizationId: 'org-1',
          },
        },
        take: 200,
      }),
    );
  });

  it("applies no department filter for ADMIN (org-wide access within their own organization)", async () => {
    await service.findSimilar('incident-1', admin);

    expect(prisma.incidentMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { incidentId: { not: 'incident-1' }, incident: { organizationId: 'org-1' } },
        take: 200,
      }),
    );
  });

  /** Phase 2.6B — cross-organization: an ADMIN from Organization B must
   * never have Organization A's incident memory show up as "similar". */
  it('scopes the candidate query to the organization of the calling ADMIN', async () => {
    const otherOrgAdmin: AuthenticatedUser = {
      id: 'admin-2',
      email: 'admin@org-b.local',
      role: Role.ADMIN,
      departmentId: null,
      organizationId: 'org-B',
    };
    await service.findSimilar('incident-1', otherOrgAdmin);

    expect(prisma.incidentMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { incidentId: { not: 'incident-1' }, incident: { organizationId: 'org-B' } },
        take: 200,
      }),
    );
  });

  it('never returns a candidate outside what the (already department-scoped) query returned', async () => {
    // The department scoping happens entirely in the query itself (above) —
    // this just confirms the ranking/slicing step downstream doesn't somehow
    // pull in anything beyond what candidates were actually returned.
    prisma.incidentMemory.findMany.mockResolvedValue([
      {
        incidentId: 'incident-2',
        vector: [1, 0, 0],
        incident: { id: 'incident-2', departmentId: 'dept-a' },
      },
    ]);

    const result = await service.findSimilar('incident-1', itTechnician, 5);

    expect(result).toHaveLength(1);
    expect(result[0].incident.id).toBe('incident-2');
  });
});
