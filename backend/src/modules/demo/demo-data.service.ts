import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventSource, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { datasetPath } from '../monitoring/dataset-path.util';
import { MonitoringService } from '../monitoring/monitoring.service';
import { parsePcapSampleEvent } from '../monitoring/pcap-samples/pcap-sample.parser';
import { loadPcapSampleEvents } from '../monitoring/pcap-samples/pcap-samples.data';

/** Arbitrary constant key for the cross-replica import mutex. */
const DEMO_IMPORT_LOCK_KEY = 'mirqab-demo-data-import';
export const DEMO_ACTOR = 'system:demo-data';
export const DEMO_IMPORT_COMPLETED_AUDIT = 'Demo dataset import completed (open-source datasets, mirqab-demo v1)';

const APT29_ORIGIN = 'Security-Datasets';
const PCAP_ORIGIN = 'PcapMonkey';

/** Departments named after the dataset each group of hosts comes from, so
 * every demo asset is visibly demo data and traceable to its source. */
export const DEMO_DEPARTMENTS = {
  apt29: 'Demo · APT29 Emulation Hosts (OTRF Security-Datasets)',
  pcap: 'Demo · Network Sensor Capture (PcapMonkey)',
} as const;

/**
 * Hostnames/IPs are taken from the datasets themselves. The APT29 emulation
 * plan names its hosts but not their addresses, and Device.ipAddress is a
 * required column — those four get RFC 5737 documentation addresses
 * (192.0.2.0/24, reserved for examples, never routable), and their OS is
 * recorded as not provided. The PcapMonkey host's IP is the real source IP
 * of every bundled Zeek event.
 */
export const DEMO_DEVICES: Array<{
  hostname: string;
  ipAddress: string;
  os: string;
  department: keyof typeof DEMO_DEPARTMENTS;
}> = [
  { hostname: 'SCRANTON', ipAddress: '192.0.2.11', os: 'Not provided by dataset', department: 'apt29' },
  { hostname: 'NASHUA', ipAddress: '192.0.2.12', os: 'Not provided by dataset', department: 'apt29' },
  { hostname: 'UTICA', ipAddress: '192.0.2.13', os: 'Not provided by dataset', department: 'apt29' },
  { hostname: 'NEWYORK', ipAddress: '192.0.2.14', os: 'Not provided by dataset', department: 'apt29' },
  { hostname: 'PCAPMONKEY-SENSOR-HOST', ipAddress: '10.12.1.101', os: 'Not provided by dataset', department: 'pcap' },
];

const APT29_HOSTS: ReadonlySet<string> = new Set(
  DEMO_DEVICES.filter((device) => device.department === 'apt29').map((device) => device.hostname),
);

interface Apt29Step {
  step: string;
  stage: string;
  techniques: string[];
  source: string;
  target: string;
  description: string;
}

export interface DemoImportSummary {
  organizationId: string;
  apt29: { total: number; imported: number; skippedExisting: number };
  pcap: { total: number; imported: number; skippedExisting: number };
}

/**
 * Evaluator demo bootstrap (infra/demo). Disabled unless
 * MIRQAB_DEMO_DATA=true. Populates the seeded demo organization ONLY from
 * the license-cleared, bundled open-source datasets:
 *   - OTRF Security-Datasets APT29 emulation plan (MIT)
 *   - PcapMonkey Zeek sample events (GPL-3.0-or-later)
 * Every event goes through the application's own existing pipeline —
 * AiService.analyzeLog (rule-based classification, MITRE mapping, IOC/IOA
 * extraction, correlation, auto-ticket, notifications) or
 * MonitoringService.ingestPcap — so nothing about the resulting incidents is
 * hand-authored. No response actions are fabricated.
 *
 * Idempotent: each source event is skipped if evidence carrying that exact
 * raw event from that dataset already exists, and the whole import runs under
 * a Postgres advisory lock so concurrent replicas can't double-import.
 */
@Injectable()
export class DemoDataService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly monitoringService: MonitoringService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.MIRQAB_DEMO_DATA !== 'true') return;
    try {
      const summary = await this.importDemoData();
      this.logger.log(`Demo data ready: ${JSON.stringify(summary)}`);
    } catch (error) {
      // Never take the API down because demo population failed — log it.
      this.logger.error(`Demo data import failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  async importDemoData(): Promise<DemoImportSummary> {
    return this.prisma.$transaction(
      async (tx) => {
        // Holds a transaction-scoped lock for the duration of the import;
        // the import's own writes go through the normal client/pipeline.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DEMO_IMPORT_LOCK_KEY}))`;
        return this.runImport();
      },
      { timeout: 10 * 60_000, maxWait: 60_000 },
    );
  }

  private async runImport(): Promise<DemoImportSummary> {
    const slug = process.env.SEED_ORGANIZATION_SLUG;
    if (!slug) {
      throw new Error('SEED_ORGANIZATION_SLUG must be set for the demo stack (see infra/demo).');
    }
    const organization = await this.prisma.organization.findUnique({ where: { slug } });
    if (!organization) {
      throw new Error(`Demo organization "${slug}" not found — the seed must run first.`);
    }

    const departmentIds = await this.ensureDepartments(organization.id);
    await this.ensureDevices(organization.id, departmentIds);
    await this.ensureOptionalUsers(organization.id, departmentIds.apt29);

    const apt29 = await this.importApt29();
    const pcap = await this.importPcap();

    const completed = await this.prisma.auditLog.findFirst({
      where: { actorEmail: DEMO_ACTOR, action: DEMO_IMPORT_COMPLETED_AUDIT },
    });
    if (!completed) {
      await this.prisma.auditLog.create({
        data: {
          actorEmail: DEMO_ACTOR,
          action: DEMO_IMPORT_COMPLETED_AUDIT,
          target: 'N/A',
          organizationId: organization.id,
        },
      });
    }

    return { organizationId: organization.id, apt29, pcap };
  }

  private async ensureDepartments(organizationId: string): Promise<Record<keyof typeof DEMO_DEPARTMENTS, string>> {
    const ids = {} as Record<keyof typeof DEMO_DEPARTMENTS, string>;
    for (const [key, name] of Object.entries(DEMO_DEPARTMENTS) as Array<[keyof typeof DEMO_DEPARTMENTS, string]>) {
      const department = await this.prisma.department.upsert({
        where: { organizationId_name: { organizationId, name } },
        create: { name, organizationId },
        update: {},
      });
      ids[key] = department.id;
    }
    return ids;
  }

  private async ensureDevices(
    organizationId: string,
    departmentIds: Record<keyof typeof DEMO_DEPARTMENTS, string>,
  ): Promise<void> {
    for (const device of DEMO_DEVICES) {
      await this.prisma.device.upsert({
        where: { hostname: device.hostname },
        create: {
          hostname: device.hostname,
          ipAddress: device.ipAddress,
          os: device.os,
          departmentId: departmentIds[device.department],
          organizationId,
        },
        update: {},
      });
    }
  }

  /** Extra RBAC-demonstration accounts — created only when BOTH their email
   * and password are configured, never with a built-in password. The
   * IT_TECHNICIAN is scoped to the APT29 department to demonstrate
   * department-level scoping. */
  private async ensureOptionalUsers(organizationId: string, technicianDepartmentId: string): Promise<void> {
    const accounts: Array<{ email?: string; password?: string; role: Role; firstName: string; lastName: string; departmentId?: string }> = [
      {
        email: process.env.DEMO_ANALYST_EMAIL,
        password: process.env.DEMO_ANALYST_PASSWORD,
        role: Role.SECURITY_ANALYST,
        firstName: 'Demo',
        lastName: 'Analyst',
      },
      {
        email: process.env.DEMO_TECHNICIAN_EMAIL,
        password: process.env.DEMO_TECHNICIAN_PASSWORD,
        role: Role.IT_TECHNICIAN,
        firstName: 'Demo',
        lastName: 'Technician',
        departmentId: technicianDepartmentId,
      },
    ];
    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);
    for (const account of accounts) {
      if (!account.email || !account.password) continue;
      const existing = await this.prisma.user.findUnique({ where: { email: account.email } });
      if (existing) continue;
      await this.prisma.user.create({
        data: {
          email: account.email,
          passwordHash: await bcrypt.hash(account.password, saltRounds),
          firstName: account.firstName,
          lastName: account.lastName,
          role: account.role,
          organizationId,
          departmentId: account.departmentId,
        },
      });
      this.logger.log(`Created demo ${account.role} account ${account.email}`);
    }
  }

  private async alreadyImported(datasetOrigin: string, rawEvent: string): Promise<boolean> {
    const existing = await this.prisma.incidentEvidence.findFirst({
      where: { datasetOrigin, rawEvent },
      select: { id: true },
    });
    return existing !== null;
  }

  private async importApt29(): Promise<DemoImportSummary['apt29']> {
    const file = JSON.parse(readFileSync(datasetPath(APT29_ORIGIN, 'apt29-attack-chain.json'), 'utf8')) as {
      steps: Apt29Step[];
    };
    let imported = 0;
    let skippedExisting = 0;
    for (const step of file.steps) {
      const rawEvent = JSON.stringify(step);
      if (await this.alreadyImported(APT29_ORIGIN, rawEvent)) {
        skippedExisting += 1;
        continue;
      }
      // The internal host the step happens on: its target, unless the target
      // is the external attacker (e.g. exfiltration "SCRANTON -> attacker"),
      // in which case the source host is the affected endpoint. Without a
      // device an incident has no organization and org scoping hides it.
      const hostname = APT29_HOSTS.has(step.target) ? step.target : step.source;
      const device = APT29_HOSTS.has(hostname)
        ? await this.prisma.device.findUnique({ where: { hostname } })
        : null;
      if (!device) {
        this.logger.warn(`APT29 step ${step.step} (${step.source} -> ${step.target}) involves no registered demo host — importing without device context`);
      }
      // Every field below is copied verbatim from the dataset row; the
      // "[DEMO DATA …]" prefix keeps the provenance visible in the UI.
      const sourceExcerpt = [
        `[DEMO DATA — OTRF Security-Datasets, APT29 emulation plan step ${step.step}] ${step.stage}`,
        step.description,
        `Techniques: ${step.techniques.join('; ')}`,
        `${step.source} -> ${step.target}`,
      ].join('\n');
      await this.aiService.analyzeLog({
        sourceExcerpt,
        deviceId: device?.id,
        rawEvent,
        ingestSource: EventSource.OPEN_SOURCE_DATASET,
        datasetOrigin: APT29_ORIGIN,
      });
      imported += 1;
    }
    return { total: file.steps.length, imported, skippedExisting };
  }

  private async importPcap(): Promise<DemoImportSummary['pcap']> {
    const events = loadPcapSampleEvents();
    let imported = 0;
    let skippedExisting = 0;
    for (const raw of events) {
      if (await this.alreadyImported(PCAP_ORIGIN, raw.raw)) {
        skippedExisting += 1;
        continue;
      }
      await this.monitoringService.ingestPcap(parsePcapSampleEvent(raw), {
        ingestSource: EventSource.OPEN_SOURCE_DATASET,
        datasetOrigin: PCAP_ORIGIN,
        rawEvent: raw.raw,
      });
      imported += 1;
    }
    return { total: events.length, imported, skippedExisting };
  }
}
