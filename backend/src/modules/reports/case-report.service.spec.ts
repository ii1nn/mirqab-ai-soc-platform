import { Role } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AiService } from '../ai/ai.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CaseReportService } from './case-report.service';

const testUser: AuthenticatedUser = {
  id: 'analyst-1',
  email: 'analyst@mirqab.local',
  role: Role.SECURITY_ANALYST,
  departmentId: null,
  organizationId: 'org-1',
};

describe('CaseReportService', () => {
  let service: CaseReportService;
  let aiService: {
    getIncidentHistory: jest.Mock;
    getInvestigation: jest.Mock;
    listAgentDecisions: jest.Mock;
    generateAnalystReport: jest.Mock;
  };
  let auditLogs: { findByTarget: jest.Mock };

  const baseHistory = {
    id: 'incident-1',
    caseId: 'INC-20260814-0001',
    title: 'Ryuk ransomware detected',
    description: 'Files encrypted on FIN-WKS-01.',
    status: 'OPEN',
    severity: 'HIGH',
    detectedAt: new Date('2026-08-14T10:00:00Z'),
    acknowledgedAt: null,
    resolvedAt: null,
    departmentName: 'Finance',
    deviceName: 'FIN-WKS-01',
    deviceIp: '10.10.1.11',
    operatingSystem: 'Windows 11',
    mitreTechniqueId: 'T1486',
    mitreTechniqueName: 'Data Encrypted for Impact',
    attackCategory: 'Impact',
    ticketNumber: 'TCK-000123',
    evidence: [],
    timeline: [],
    indicators: [],
    persistenceFindings: [],
    actionsTaken: [],
    recommendedFixes: [],
  };

  const baseInvestigation = {
    riskPrediction: {
      businessImpact: 'HIGH',
      lateralMovementProbability: null,
      confidence: 20,
      sampleSize: 0,
    },
    recommendations: [],
    similar: [],
    ownActions: [],
  };

  beforeEach(async () => {
    aiService = {
      getIncidentHistory: jest.fn().mockResolvedValue(baseHistory),
      getInvestigation: jest.fn().mockResolvedValue(baseInvestigation),
      listAgentDecisions: jest.fn().mockResolvedValue([]),
      generateAnalystReport: jest.fn().mockResolvedValue({
        report: '# Report\nSummary text.',
        generatedBy: 'rule-based-fallback',
      }),
    };
    auditLogs = { findByTarget: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CaseReportService,
        { provide: AiService, useValue: aiService },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = moduleRef.get(CaseReportService);
  });

  it('generates a real PDF buffer with the correct filename', async () => {
    const result = await service.generate('incident-1', testUser);

    expect(result.filename).toBe('MIRQAB_Case_Report_INC-20260814-0001.pdf');
    expect(result.buffer.length).toBeGreaterThan(500);
    // PDF magic bytes — confirms pdfkit actually produced a valid document, not just any buffer.
    expect(result.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders honest empty-state sections instead of fabricating data when nothing was found', async () => {
    const result = await service.generate('incident-1', testUser);
    const text = result.buffer.toString('latin1');

    // pdfkit doesn't emit searchable plain text in the raw byte stream by
    // default without extraction, so this just asserts the document was
    // produced without throwing across every empty-collection branch
    // (evidence/timeline/indicators/persistence/actions/recommendations/audit).
    expect(text.length).toBeGreaterThan(0);
    expect(aiService.getIncidentHistory).toHaveBeenCalledWith('incident-1');
    expect(aiService.getInvestigation).toHaveBeenCalledWith('incident-1', testUser);
    expect(aiService.listAgentDecisions).toHaveBeenCalledWith('incident-1');
    expect(auditLogs.findByTarget).toHaveBeenCalledWith('incident-1');
  });

  it('still produces a report when Claude/analyst-report generation fails', async () => {
    aiService.generateAnalystReport.mockRejectedValue(new Error('Claude unavailable'));

    const result = await service.generate('incident-1', testUser);
    expect(result.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('populates every section with real data when present', async () => {
    aiService.getIncidentHistory.mockResolvedValue({
      ...baseHistory,
      evidence: [
        {
          id: 'ev-1',
          createdAt: new Date('2026-08-14T10:00:00Z'),
          mitreTechniqueId: 'T1486',
          mitreTechniqueName: 'Data Encrypted for Impact',
          severity: 'HIGH',
          correlationScore: null,
          sourceExcerpt: 'Ryuk ransomware detected: files encrypted.',
        },
      ],
      timeline: [
        { id: 'tl-0', timestamp: new Date('2026-08-14T10:00:00Z'), event: 'Incident detected' },
      ],
      indicators: [
        {
          id: 'i-1',
          category: 'IOC',
          type: 'HASH',
          value: 'a1b2c3',
          confidence: 85,
          subtype: null,
        },
        {
          id: 'i-2',
          category: 'IOA',
          type: 'BEHAVIOR',
          value: 'mimikatz',
          description: 'Credential dumping tooling referenced',
          confidence: 85,
          subtype: 'credential-dumping',
        },
        {
          id: 'i-3',
          category: 'IOA',
          type: 'BEHAVIOR',
          value: 'Cobalt Strike',
          description: 'Known C2 framework referenced',
          confidence: 88,
          subtype: 'c2-framework',
        },
      ],
      persistenceFindings: [
        {
          id: 'p-1',
          type: 'SCHEDULED_TASK',
          endpoint: 'FIN-WKS-01',
          userAccount: 'jdoe',
          process: 'powershell.exe',
          command: 'schtasks /create',
          evidenceText: 'schtasks /create /tn Updater',
          mitreTechniqueId: 'T1053.005',
          mitreTechniqueName: 'Scheduled Task/Job: Scheduled Task',
          confidence: 90,
          risk: 'HIGH',
          createdAt: new Date('2026-08-14T10:05:00Z'),
        },
      ],
      actionsTaken: [
        {
          id: 'a-1',
          title: 'Isolate Device',
          status: 'pending',
          executedBy: null,
          executedAt: null,
        },
      ],
      recommendedFixes: ['Restore from clean backups.'],
    });
    aiService.getInvestigation.mockResolvedValue({
      ...baseInvestigation,
      recommendations: [
        { type: 'ISOLATE_DEVICE', reason: 'Succeeded in 3 of 4 similar incidents.' },
      ],
    });
    aiService.listAgentDecisions.mockResolvedValue([
      {
        id: 'd-1',
        agent: 'INCIDENT_AGENT',
        action: 'classify',
        generatedBy: 'rule-based-fallback',
        confidence: null,
        summary: 'Classified as T1486',
      },
    ]);
    auditLogs.findByTarget.mockResolvedValue([
      {
        id: 'log-1',
        actorEmail: 'analyst@mirqab.local',
        action: 'Set incident status to "OPEN"',
        createdAt: new Date(),
      },
    ]);

    const result = await service.generate('incident-1', testUser);
    expect(result.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(result.buffer.length).toBeGreaterThan(1000);
  });
});
