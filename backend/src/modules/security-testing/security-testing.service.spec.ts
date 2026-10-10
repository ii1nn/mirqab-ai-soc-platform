import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { MitreMappingService } from '../ai/mitre-attack/mitre-mapping.service';
import { SecurityTestingService } from './security-testing.service';

describe('SecurityTestingService', () => {
  let service: SecurityTestingService;
  let prisma: {
    incident: { create: jest.Mock; delete: jest.Mock };
    organization: { upsert: jest.Mock };
  };
  let mitre: { getById: jest.Mock };
  let aiService: {
    applyRecommended: jest.Mock;
    updateIncidentAction: jest.Mock;
    approveIncidentAction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      incident: {
        create: jest.fn(async ({ data }) => ({ id: 'test-incident-1', ...data })),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      organization: {
        upsert: jest.fn().mockResolvedValue({ id: 'org-security-testing-internal' }),
      },
    };
    mitre = { getById: jest.fn().mockReturnValue(undefined) };

    let approved = false;
    aiService = {
      applyRecommended: jest
        .fn()
        .mockResolvedValue([{ id: 'action-1', approvalStatus: 'PENDING_APPROVAL' }]),
      updateIncidentAction: jest.fn(async () => {
        if (!approved) throw new BadRequestException('requires analyst approval');
        return { id: 'action-1', outcome: 'SUCCESS' };
      }),
      approveIncidentAction: jest.fn(async () => {
        approved = true;
        return { id: 'action-1', approvalStatus: 'APPROVED' };
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SecurityTestingService,
        { provide: PrismaService, useValue: prisma },
        { provide: MitreMappingService, useValue: mitre },
        { provide: AiService, useValue: aiService },
      ],
    }).compile();

    service = moduleRef.get(SecurityTestingService);
  });

  it('runs all scenarios and every real-detection-logic scenario passes on known-positive fixtures', async () => {
    const report = await service.runAll();

    expect(report.summary.total).toBe(report.results.length);
    expect(report.summary.total).toBeGreaterThanOrEqual(10);

    const byName = (name: string) => report.results.find((r) => r.name.includes(name));
    expect(byName('Persistence detection')?.passed).toBe(true);
    expect(byName('IOC detection')?.passed).toBe(true);
    expect(byName('IOA detection')?.passed).toBe(true);
    expect(byName('C2 detection')?.passed).toBe(true);
    expect(byName('Prompt injection resistance')?.passed).toBe(true);
    expect(byName('AI output validation')?.passed).toBe(true);
    expect(byName('Wazuh ingestion')?.passed).toBe(true);
    expect(byName('Agent permissions')?.passed).toBe(true);
    expect(byName('API authorization')?.passed).toBe(true);
  });

  it('MITRE hallucination guard scenario fails loudly if the lookup ever starts accepting invented IDs', async () => {
    mitre.getById.mockReturnValue({
      id: 'T9999-NOT-A-REAL-TECHNIQUE',
      name: 'fake',
      tactic: 'fake',
      keywords: [],
    });
    const report = await service.runAll();
    const result = report.results.find((r) => r.name.includes('hallucination'));
    expect(result?.passed).toBe(false);
  });

  it('exercises the real AiService approval gate for response authorization, not a re-implementation', async () => {
    const report = await service.runAll();
    const result = report.results.find((r) => r.name.includes('Response authorization'));

    expect(aiService.applyRecommended).toHaveBeenCalledWith(
      'test-incident-1',
      ['ISOLATE_DEVICE'],
      'security-testing-mode',
    );
    expect(aiService.updateIncidentAction).toHaveBeenCalledTimes(2);
    expect(aiService.approveIncidentAction).toHaveBeenCalledTimes(1);
    expect(result?.passed).toBe(true);
  });

  it('always deletes the transient test incident, even when a scenario throws unexpectedly', async () => {
    aiService.applyRecommended.mockRejectedValue(new Error('unexpected failure'));
    await expect(service.runAll()).rejects.toThrow('unexpected failure');
    expect(prisma.incident.delete).toHaveBeenCalledWith({ where: { id: 'test-incident-1' } });
  });

  it('tags the transient test incident clearly and never touches real case data', async () => {
    await service.runAll();
    const createArgs = prisma.incident.create.mock.calls[0][0];
    expect(createArgs.data.title).toContain('[SECURITY TEST]');
    expect(createArgs.data.caseId).toMatch(/^TEST-/);
  });
});
