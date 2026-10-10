import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { DEMO_DEVICES, DEMO_IMPORT_COMPLETED_AUDIT, DemoDataService } from './demo-data.service';

/**
 * Runs against the REAL bundled dataset files (datasets/Security-Datasets,
 * datasets/PcapMonkey) — only the database and the ingestion pipeline are
 * mocked, so this proves which real events would be imported and that a
 * second run imports nothing.
 */
describe('DemoDataService (evaluator demo bootstrap)', () => {
  let service: DemoDataService;
  let importedRaw: Set<string>;
  let prisma: Record<string, any>;
  let aiService: { analyzeLog: jest.Mock };
  let monitoringService: { ingestPcap: jest.Mock };
  const env = { ...process.env };

  beforeEach(async () => {
    process.env.SEED_ORGANIZATION_SLUG = 'mirqab-demo';
    delete process.env.DEMO_ANALYST_EMAIL;
    delete process.env.DEMO_ANALYST_PASSWORD;
    delete process.env.DEMO_TECHNICIAN_EMAIL;
    delete process.env.DEMO_TECHNICIAN_PASSWORD;
    process.env.BCRYPT_SALT_ROUNDS = '4';
    importedRaw = new Set();

    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-demo', slug: 'mirqab-demo' }) },
      department: { upsert: jest.fn(async ({ create }) => ({ id: `dept-${create.name.length}`, ...create })) },
      device: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(async ({ where }) => ({ id: `device-${where.hostname}` })),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      incidentEvidence: {
        findFirst: jest.fn(async ({ where }) => (importedRaw.has(`${where.datasetOrigin}|${where.rawEvent}`) ? { id: 'e' } : null)),
      },
      auditLog: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    };
    aiService = {
      analyzeLog: jest.fn(async (input) => {
        importedRaw.add(`${input.datasetOrigin}|${input.rawEvent}`);
        return {};
      }),
    };
    monitoringService = {
      ingestPcap: jest.fn(async (_event, meta) => {
        importedRaw.add(`${meta.datasetOrigin}|${meta.rawEvent}`);
        return {};
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DemoDataService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiService, useValue: aiService },
        { provide: MonitoringService, useValue: monitoringService },
      ],
    }).compile();
    service = moduleRef.get(DemoDataService);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('does nothing unless MIRQAB_DEMO_DATA=true', async () => {
    delete process.env.MIRQAB_DEMO_DATA;
    await service.onApplicationBootstrap();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(aiService.analyzeLog).not.toHaveBeenCalled();
  });

  it('imports every bundled open-source event exactly once, through the real pipelines, tagged with its dataset', async () => {
    const summary = await service.importDemoData();

    expect(summary.apt29).toEqual({ total: 22, imported: 22, skippedExisting: 0 });
    expect(summary.pcap).toEqual({ total: 6, imported: 6, skippedExisting: 0 });
    expect(prisma.$executeRaw).toHaveBeenCalled(); // advisory lock taken

    const apt29Call = aiService.analyzeLog.mock.calls[0][0];
    expect(apt29Call).toMatchObject({ ingestSource: 'OPEN_SOURCE_DATASET', datasetOrigin: 'Security-Datasets' });
    expect(apt29Call.sourceExcerpt).toMatch(/^\[DEMO DATA — OTRF Security-Datasets, APT29 emulation plan step 1\.A\]/);
    expect(apt29Call.deviceId).toBe('device-SCRANTON');
    expect(JSON.parse(apt29Call.rawEvent)).toMatchObject({ step: '1.A', target: 'SCRANTON' });

    const pcapCall = monitoringService.ingestPcap.mock.calls[0];
    expect(pcapCall[0].sourceIp).toBe('10.12.1.101');
    expect(pcapCall[1]).toMatchObject({ ingestSource: 'OPEN_SOURCE_DATASET', datasetOrigin: 'PcapMonkey' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: DEMO_IMPORT_COMPLETED_AUDIT, organizationId: 'org-demo' }),
    });
  });

  it('attributes every APT29 step to a registered demo host — exfiltration to "attacker" lands on its source host', async () => {
    await service.importDemoData();
    const apt29Calls = aiService.analyzeLog.mock.calls.map(([input]) => input);
    expect(apt29Calls.every((input) => typeof input.deviceId === 'string')).toBe(true);
    const exfil = apt29Calls.find((input) => JSON.parse(input.rawEvent).step === '2.B');
    expect(JSON.parse(exfil.rawEvent)).toMatchObject({ source: 'SCRANTON', target: 'attacker' });
    expect(exfil.deviceId).toBe('device-SCRANTON');
  });

  it('is idempotent: a second run imports nothing and writes no second completion marker', async () => {
    await service.importDemoData();
    aiService.analyzeLog.mockClear();
    monitoringService.ingestPcap.mockClear();
    prisma.auditLog.create.mockClear();
    prisma.auditLog.findFirst.mockResolvedValue({ id: 'marker' });

    const second = await service.importDemoData();

    expect(second.apt29).toEqual({ total: 22, imported: 0, skippedExisting: 22 });
    expect(second.pcap).toEqual({ total: 6, imported: 0, skippedExisting: 6 });
    expect(aiService.analyzeLog).not.toHaveBeenCalled();
    expect(monitoringService.ingestPcap).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('registers the dataset hosts in the demo organization without ever overwriting an existing device', async () => {
    await service.importDemoData();
    expect(prisma.device.upsert).toHaveBeenCalledTimes(DEMO_DEVICES.length);
    for (const call of prisma.device.upsert.mock.calls) {
      expect(call[0].update).toEqual({});
      expect(call[0].create.organizationId).toBe('org-demo');
    }
    expect(prisma.device.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hostname: 'PCAPMONKEY-SENSOR-HOST' }, create: expect.objectContaining({ ipAddress: '10.12.1.101' }) }),
    );
  });

  it('creates optional RBAC demo accounts only when both email and password are configured, and never twice', async () => {
    process.env.DEMO_ANALYST_EMAIL = 'analyst@demo.local';
    process.env.DEMO_ANALYST_PASSWORD = 'a-configured-password';
    process.env.DEMO_TECHNICIAN_EMAIL = 'tech@demo.local'; // no password → skipped

    await service.importDemoData();
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
      email: 'analyst@demo.local',
      role: 'SECURITY_ANALYST',
      organizationId: 'org-demo',
    });
    expect(prisma.user.create.mock.calls[0][0].data.passwordHash).not.toBe('a-configured-password');

    prisma.user.create.mockClear();
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
    await service.importDemoData();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses to run without the demo organization (the seed must run first)', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);
    await expect(service.importDemoData()).rejects.toThrow('Demo organization "mirqab-demo" not found');
    expect(aiService.analyzeLog).not.toHaveBeenCalled();
  });
});
