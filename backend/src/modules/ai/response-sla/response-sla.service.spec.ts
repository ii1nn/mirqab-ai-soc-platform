import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { IncidentAccessGuard } from '../../../common/guards/incident-access.guard';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { EndpointControlService } from '../../devices/endpoint-control/endpoint-control.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AiController } from '../ai.controller';
import { AiService } from '../ai.service';
import { AutoResponsePolicyService } from '../auto-response/auto-response-policy.service';
import { RESPONSE_AUDIT, RESPONSE_WINDOW_MS } from './response-sla.constants';
import { ResponseSlaService } from './response-sla.service';
import {
  buildResponseView,
  evaluateContainmentEligibility,
  resetSimulatedColumnCache,
  responseDeadline,
} from './response-sla.util';

/* ------------------------------------------------------------------------ *
 * In-memory stand-in for the handful of Prisma calls ResponseSlaService
 * makes. The advisory lock is a REAL per-key mutex held until the
 * transaction callback settles, so concurrency tests exercise genuine
 * interleavings (two replicas, sweep vs. acknowledge) rather than asserting
 * on mock call order.
 * ------------------------------------------------------------------------ */

type Row = Record<string, any>;

class FakeDb {
  incidents = new Map<string, Row>();
  actions: Row[] = [];
  audits: Row[] = [];
  policyEnabled: boolean | null = true; // null = row missing
  simulatedFlag = new Set<string>();
  /** false = a fresh database built from the repo's migrations (no drift column). */
  simulatedColumn = true;
  private locks = new Map<string, Promise<void>>();
  private seq = 0;

  nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  addIncident(overrides: Row = {}): Row {
    const id = overrides.id ?? this.nextId('incident');
    const incident = {
      id,
      caseId: `INC-TEST-${id}`,
      severity: 'HIGH',
      status: 'OPEN',
      acknowledgedAt: null,
      deviceId: 'device-1',
      departmentId: 'dept-1',
      organizationId: 'org-1',
      ingestSource: 'LIVE_AGENT',
      createdAt: new Date(Date.now() - 6 * 60_000),
      ...overrides,
    };
    this.incidents.set(id, incident);
    return incident;
  }

  actionsFor(incidentId: string) {
    return this.actions.filter((action) => action.incidentId === incidentId);
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const chained = previous.then(() => current);
    this.locks.set(key, chained);
    await previous;
    return release;
  }

  private matchesAction(action: string, cond: any): boolean {
    if (typeof cond === 'string') return action === cond;
    if (cond?.in) return cond.in.includes(action);
    if (cond?.startsWith) return action.startsWith(cond.startsWith);
    return true;
  }

  private matchesAudit(row: Row, where: any): boolean {
    if (where.target !== undefined) {
      if (typeof where.target === 'string' && row.target !== where.target) return false;
      if (where.target?.in && !where.target.in.includes(row.target)) return false;
    }
    if (where.action !== undefined && !this.matchesAction(row.action, where.action)) return false;
    if (where.OR && !where.OR.some((clause: any) => this.matchesAction(row.action, clause.action))) return false;
    return true;
  }

  client(releases?: (() => void)[]): any {
    const db = this;
    const withActions = (incident: Row | undefined) =>
      incident ? { ...incident, actions: db.actionsFor(incident.id) } : null;
    return {
      $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
        if (!releases) throw new Error('advisory lock requested outside a transaction');
        releases.push(await db.acquire(key));
      },
      $queryRaw: async (strings: TemplateStringsArray, ids?: string[]) => {
        if (strings.join('').includes('information_schema.columns')) {
          return [{ present: db.simulatedColumn }];
        }
        if (!db.simulatedColumn) {
          throw new Error('column "isSimulated" does not exist'); // what Postgres does
        }
        return (ids ?? []).filter((id) => db.simulatedFlag.has(id)).map((id) => ({ id }));
      },
      $transaction: async (fn: (tx: any) => Promise<unknown>) => {
        const held: (() => void)[] = [];
        try {
          return await fn(db.client(held));
        } finally {
          held.forEach((release) => release());
        }
      },
      incident: {
        findUnique: async ({ where, include }: any) => {
          const incident = db.incidents.get(where.id);
          if (!incident) return null;
          return include?.actions ? withActions(incident) : { ...incident };
        },
        update: async ({ where, data }: any) => {
          const incident = db.incidents.get(where.id)!;
          for (const [key, value] of Object.entries(data)) {
            if (value !== undefined) incident[key] = value;
          }
          return { ...incident };
        },
        findMany: async ({ where, take }: any) => {
          const rows = [...db.incidents.values()].filter(
            (incident) =>
              incident.status === where.status &&
              incident.acknowledgedAt === null &&
              where.severity.in.includes(incident.severity) &&
              incident.deviceId !== null &&
              incident.organizationId !== null &&
              incident.createdAt.getTime() <= where.createdAt.lte.getTime() &&
              !db.actionsFor(incident.id).some((action) => action.type === 'ISOLATE_DEVICE'),
          );
          return rows
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .slice(0, take)
            .map((incident) => ({ id: incident.id }));
        },
      },
      incidentAction: {
        create: async ({ data }: any) => {
          const action = { id: db.nextId('action'), createdAt: new Date(), updatedAt: new Date(), ...data };
          db.actions.push(action);
          return { ...action };
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          const audit = { id: db.nextId('audit'), createdAt: new Date(), ...data };
          db.audits.push(audit);
          return { ...audit };
        },
        findFirst: async ({ where }: any) => db.audits.find((row) => db.matchesAudit(row, where)) ?? null,
        findMany: async ({ where }: any) => db.audits.filter((row) => db.matchesAudit(row, where)),
      },
      policy: {
        findUnique: async () =>
          db.policyEnabled === null ? null : { name: '5-Minute Response Window', enabled: db.policyEnabled },
      },
    };
  }
}

describe('ResponseSlaService — the single authoritative 5-minute response window', () => {
  let db: FakeDb;
  let endpointControl: { isAvailable: jest.Mock };
  let aiService: { completeAutomatedIsolation: jest.Mock };
  let notifications: { notifyContainmentResult: jest.Mock; notifyResponseRequired: jest.Mock };
  let events: { emit: jest.Mock };

  const analyst: AuthenticatedUser = {
    id: 'user-1',
    email: 'tech@mirqab.local',
    role: Role.IT_TECHNICIAN,
    departmentId: 'dept-1',
    organizationId: 'org-1',
  };

  /** Stand-in for AiService.completeAutomatedIsolation (its own behavior is
   * covered in ai.service.spec.ts): resolves the pre-created PENDING row via
   * a mocked provider. No real endpoint is ever contacted in this suite. */
  let providerOutcome: 'SUCCESS' | 'FAILED';

  async function buildService(): Promise<ResponseSlaService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResponseSlaService,
        { provide: PrismaService, useValue: db.client() },
        { provide: EventEmitter2, useValue: events },
        { provide: EndpointControlService, useValue: endpointControl },
        { provide: AiService, useValue: aiService },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    return moduleRef.get(ResponseSlaService);
  }

  let service: ResponseSlaService;

  beforeEach(async () => {
    resetSimulatedColumnCache();
    db = new FakeDb();
    endpointControl = { isAvailable: jest.fn().mockReturnValue(true) };
    providerOutcome = 'FAILED';
    aiService = {
      completeAutomatedIsolation: jest.fn(async (actionId: string) => {
        const action = db.actions.find((row) => row.id === actionId)!;
        expect(action.outcome).toBe('PENDING'); // row exists BEFORE the provider is called
        action.outcome = providerOutcome;
        action.notes = providerOutcome === 'FAILED' ? 'fetch failed' : 'Agent confirmed isolation.';
        return { ...action };
      }),
    };
    notifications = {
      notifyContainmentResult: jest.fn().mockResolvedValue(null),
      notifyResponseRequired: jest.fn().mockResolvedValue(null),
    };
    events = { emit: jest.fn() };
    service = await buildService();
  });

  const auditActions = (incidentId: string) =>
    db.audits.filter((row) => row.target === incidentId).map((row) => row.action);

  describe('deadline and state (pure rules)', () => {
    it('uses exactly 5 minutes, anchored to createdAt (T0)', () => {
      const createdAt = new Date('2026-09-26T10:00:00.000Z');
      expect(RESPONSE_WINDOW_MS).toBe(300_000);
      expect(responseDeadline(createdAt).toISOString()).toBe('2026-09-26T10:05:00.000Z');
    });

    it('reports WAITING_RESPONSE with the remaining time before the deadline, then WINDOW_EXPIRED after it', () => {
      const createdAt = new Date('2026-09-26T10:00:00.000Z');
      const subject = {
        createdAt,
        acknowledgedAt: null,
        status: 'OPEN' as const,
        severity: 'HIGH' as const,
        deviceId: 'd',
        organizationId: 'o',
        ingestSource: 'LIVE_AGENT' as const,
      };
      const ctx = { policyEnabled: true, providerAvailable: true, simulated: false };
      const facts = { acknowledgedBy: null, decided: false, decisionReason: null };

      const before = buildResponseView(subject, [], { ...ctx, now: new Date('2026-09-26T10:00:01.000Z') }, facts);
      expect(before.state).toBe('WAITING_RESPONSE');
      expect(before.remainingMs).toBe(299_000);
      expect(before.automatedContainment.eligible).toBe(false);
      expect(before.automatedContainment.blockedReason).toBe('WINDOW_OPEN');

      const after = buildResponseView(subject, [], { ...ctx, now: new Date('2026-09-26T10:05:00.000Z') }, facts);
      expect(after.state).toBe('WINDOW_EXPIRED');
      expect(after.automatedContainment.eligible).toBe(true);
    });

    it('reports ACKNOWLEDGED with respondedInMs measured from createdAt', () => {
      const createdAt = new Date('2026-09-26T10:00:00.000Z');
      const view = buildResponseView(
        {
          createdAt,
          acknowledgedAt: new Date('2026-09-26T10:02:14.000Z'),
          status: 'INVESTIGATING',
          severity: 'CRITICAL',
          deviceId: 'd',
          organizationId: 'o',
          ingestSource: 'LIVE_AGENT',
        },
        [],
        { now: new Date('2026-09-26T11:00:00.000Z'), policyEnabled: true, providerAvailable: true, simulated: false },
        { acknowledgedBy: 'tech@mirqab.local', decided: false, decisionReason: null },
      );
      expect(view.state).toBe('ACKNOWLEDGED');
      expect(view.respondedInMs).toBe(134_000);
      expect(view.respondedWithinWindow).toBe(true);
      expect(view.acknowledgedBy).toBe('tech@mirqab.local');
      expect(view.automatedContainment.blockedReason).toBe('NOT_OPEN');
    });

    it('an automated containment stays the headline even when an acknowledgement lands in the same millisecond', () => {
      const at = new Date('2026-09-26T10:06:00.000Z');
      const subject = {
        createdAt: new Date('2026-09-26T10:00:00.000Z'),
        acknowledgedAt: at,
        status: 'CONTAINED' as const,
        severity: 'HIGH' as const,
        deviceId: 'd',
        organizationId: 'o',
        ingestSource: 'LIVE_AGENT' as const,
      };
      const isolation = {
        id: 'a',
        type: 'ISOLATE_DEVICE' as const,
        outcome: 'SUCCESS' as const,
        notes: null,
        createdAt: at,
        updatedAt: at,
      };
      const ctx = { now: at, policyEnabled: true, providerAvailable: true, simulated: false };
      const facts = { acknowledgedBy: null, decided: true, decisionReason: null };

      const automated = buildResponseView(subject, [{ ...isolation, performedBy: 'system:automated-containment' }], ctx, facts);
      expect(automated.state).toBe('CONTAINMENT_SUCCEEDED');
      expect(automated.containment?.automated).toBe(true);

      // An analyst who acknowledged and THEN isolated is a normal investigation.
      const manual = buildResponseView(
        { ...subject, acknowledgedAt: new Date('2026-09-26T10:01:00.000Z') },
        [{ ...isolation, performedBy: 'analyst@mirqab.local' }],
        ctx,
        facts,
      );
      expect(manual.state).toBe('ACKNOWLEDGED');
      expect(manual.containment?.automated).toBe(false);
    });

    it('LOW/MEDIUM incidents have no response window and are never eligible', () => {
      for (const severity of ['LOW', 'MEDIUM'] as const) {
        const evaluation = evaluateContainmentEligibility(
          {
            createdAt: new Date(0),
            acknowledgedAt: null,
            status: 'OPEN',
            severity,
            deviceId: 'd',
            organizationId: 'o',
            ingestSource: 'LIVE_AGENT',
          },
          [],
          { now: new Date(), policyEnabled: true, providerAvailable: true, simulated: false },
        );
        expect(evaluation).toEqual({ eligible: false, reason: 'SEVERITY_NOT_ELIGIBLE', atDecisionPoint: false });
      }
    });
  });

  describe('sweep — automated containment eligibility', () => {
    it('does NOT contain an incident still inside its 5-minute window', async () => {
      const incident = db.addIncident({ createdAt: new Date(Date.now() - 4 * 60_000 - 59_000) });
      await service.sweep();
      expect(db.actionsFor(incident.id)).toHaveLength(0);
      expect(auditActions(incident.id)).toHaveLength(0);
    });

    it.each(['HIGH', 'CRITICAL'])(
      'contains an unacknowledged %s incident once the 5 minutes have passed: PENDING row first, then the provider',
      async (severity) => {
        const incident = db.addIncident({ severity });
        await service.sweep();

        const actions = db.actionsFor(incident.id);
        expect(actions).toHaveLength(1);
        expect(actions[0]).toMatchObject({
          type: 'ISOLATE_DEVICE',
          performedBy: 'system:automated-containment',
          requestedBy: 'system:automated-containment',
          approvalStatus: 'NOT_REQUIRED',
        });
        expect(aiService.completeAutomatedIsolation).toHaveBeenCalledWith(actions[0].id, 'system:automated-containment');
        expect(auditActions(incident.id)).toEqual([
          RESPONSE_AUDIT.WINDOW_EXPIRED,
          RESPONSE_AUDIT.CONTAINMENT_REQUESTED,
        ]);
        expect(events.emit).toHaveBeenCalledWith(
          'incident-action.created',
          expect.objectContaining({ organizationId: 'org-1', departmentId: 'dept-1' }),
        );
      },
    );

    it('records a configured-but-unreachable provider as FAILED with the real reason and notifies', async () => {
      providerOutcome = 'FAILED';
      const incident = db.addIncident();
      await service.sweep();

      expect(db.actionsFor(incident.id)[0]).toMatchObject({ outcome: 'FAILED', notes: 'fetch failed' });
      expect(notifications.notifyContainmentResult).toHaveBeenCalledWith(incident.id, 'FAILED', 'fetch failed');
    });

    it('reports SUCCEEDED only when the provider verified it', async () => {
      providerOutcome = 'SUCCESS';
      const incident = db.addIncident();
      await service.sweep();
      expect(notifications.notifyContainmentResult).toHaveBeenCalledWith(incident.id, 'SUCCEEDED', null);
    });

    it.each(['LOW', 'MEDIUM'])('never contains a %s incident', async (severity) => {
      const incident = db.addIncident({ severity, createdAt: new Date(Date.now() - 60 * 60_000) });
      await service.sweep();
      expect(db.actionsFor(incident.id)).toHaveLength(0);
      expect(auditActions(incident.id)).toHaveLength(0);
    });

    it('never contains an incident with no device, or with no organization', async () => {
      const noDevice = db.addIncident({ deviceId: null });
      const noOrg = db.addIncident({ organizationId: null });
      await service.sweep();
      expect(db.actions).toHaveLength(0);
      expect(auditActions(noDevice.id)).toHaveLength(0);
      expect(auditActions(noOrg.id)).toHaveLength(0);
    });

    it('never contains a simulated incident (ingestSource SIMULATION) — records why, creates no IncidentAction', async () => {
      const incident = db.addIncident({ ingestSource: 'SIMULATION' });
      await service.sweep();
      expect(db.actionsFor(incident.id)).toHaveLength(0);
      expect(aiService.completeAutomatedIsolation).not.toHaveBeenCalled();
      expect(auditActions(incident.id)).toEqual([
        RESPONSE_AUDIT.WINDOW_EXPIRED,
        RESPONSE_AUDIT.CONTAINMENT_SIMULATED,
      ]);
    });

    it("never contains an incident flagged by the database's isSimulated column", async () => {
      const incident = db.addIncident({ ingestSource: 'MANUAL_TEST' });
      db.simulatedFlag.add(incident.id);
      await service.sweep();
      expect(db.actionsFor(incident.id)).toHaveLength(0);
      expect(auditActions(incident.id)).toContain(RESPONSE_AUDIT.CONTAINMENT_SIMULATED);
    });

    it('FRESH database (no drift-only isSimulated column): never errors — the sweep still decides, and response views still build', async () => {
      db.simulatedColumn = false;
      const incident = db.addIncident();
      const simulated = db.addIncident({ ingestSource: 'SIMULATION' });

      await service.sweep();

      expect(db.actionsFor(incident.id)).toHaveLength(1); // decided normally
      expect(db.actionsFor(simulated.id)).toHaveLength(0); // ingestSource still protects
      expect(auditActions(simulated.id)).toContain(RESPONSE_AUDIT.CONTAINMENT_SIMULATED);
      await expect(service.getResponseView(incident.id)).resolves.toMatchObject({
        state: 'CONTAINMENT_FAILED',
      });
    });

    it('no endpoint-control provider configured → NO IncidentAction, no fake FAILED; records "unavailable" and notifies', async () => {
      endpointControl.isAvailable.mockReturnValue(false);
      const incident = db.addIncident();
      await service.sweep();

      expect(db.actionsFor(incident.id)).toHaveLength(0);
      expect(aiService.completeAutomatedIsolation).not.toHaveBeenCalled();
      expect(auditActions(incident.id)).toEqual([
        RESPONSE_AUDIT.WINDOW_EXPIRED,
        'Automated containment unavailable: no endpoint-control provider configured.',
      ]);
      expect(notifications.notifyContainmentResult).toHaveBeenCalledWith(incident.id, 'UNAVAILABLE');
    });

    it('policy kill switch: a disabled "5-Minute Response Window" policy blocks containment', async () => {
      db.policyEnabled = false;
      const incident = db.addIncident();
      await service.sweep();
      expect(db.actionsFor(incident.id)).toHaveLength(0);
      expect(auditActions(incident.id)).toContain(RESPONSE_AUDIT.CONTAINMENT_POLICY_DISABLED);
      expect(notifications.notifyContainmentResult).toHaveBeenCalledWith(incident.id, 'POLICY_DISABLED');
    });

    it('fails closed when the policy row is missing', async () => {
      db.policyEnabled = null;
      const incident = db.addIncident();
      await service.sweep();
      expect(db.actionsFor(incident.id)).toHaveLength(0);
    });

    it.each(['PENDING', 'SUCCESS', 'FAILED'])(
      'an existing %s isolation action prevents any further automated attempt',
      async (outcome) => {
        const incident = db.addIncident();
        db.actions.push({ id: 'existing', incidentId: incident.id, type: 'ISOLATE_DEVICE', outcome, performedBy: 'analyst@x' });
        await service.sweep();
        expect(db.actionsFor(incident.id)).toHaveLength(1);
        expect(aiService.completeAutomatedIsolation).not.toHaveBeenCalled();
        expect(auditActions(incident.id)).toHaveLength(0);
      },
    );

    it('once-only: repeated sweeps never duplicate the decision audit rows or notifications', async () => {
      endpointControl.isAvailable.mockReturnValue(false);
      const incident = db.addIncident();
      await service.sweep();
      await service.sweep();
      await service.sweep();
      expect(auditActions(incident.id)).toHaveLength(2);
      expect(notifications.notifyContainmentResult).toHaveBeenCalledTimes(1);
    });

    it('a decision taken while the provider was unavailable is final — configuring a provider later never isolates that stale incident', async () => {
      endpointControl.isAvailable.mockReturnValue(false);
      const incident = db.addIncident();
      await service.sweep();
      endpointControl.isAvailable.mockReturnValue(true);
      await service.sweep();
      expect(db.actionsFor(incident.id)).toHaveLength(0);
    });

    it('tracks multiple incidents independently', async () => {
      const expired = db.addIncident();
      const waiting = db.addIncident({ createdAt: new Date(Date.now() - 60_000) });
      const acknowledged = db.addIncident({ acknowledgedAt: new Date(), status: 'INVESTIGATING' });
      await service.sweep();
      expect(db.actionsFor(expired.id)).toHaveLength(1);
      expect(db.actionsFor(waiting.id)).toHaveLength(0);
      expect(db.actionsFor(acknowledged.id)).toHaveLength(0);
    });
  });

  describe('acknowledgement', () => {
    it('before expiry: stamps acknowledgedAt, moves OPEN → INVESTIGATING, audits, and prevents future containment', async () => {
      const incident = db.addIncident({ createdAt: new Date(Date.now() - 60_000) });
      const result = await service.acknowledge(incident.id, analyst);

      expect(result.alreadyAcknowledged).toBe(false);
      expect(db.incidents.get(incident.id)).toMatchObject({ status: 'INVESTIGATING' });
      expect(db.incidents.get(incident.id)!.acknowledgedAt).toBeInstanceOf(Date);
      expect(auditActions(incident.id)).toEqual([RESPONSE_AUDIT.ACKNOWLEDGED_WITHIN_WINDOW]);
      expect(db.audits[0]).toMatchObject({ actorEmail: 'tech@mirqab.local', organizationId: 'org-1' });
      expect(result.response.state).toBe('ACKNOWLEDGED');
      expect(result.response.acknowledgedBy).toBe('tech@mirqab.local');

      // Even long after the window, nothing is contained.
      await service.sweep(new Date(Date.now() + 60 * 60_000));
      expect(db.actionsFor(incident.id)).toHaveLength(0);
    });

    it('after expiry (before the sweep acted): still recorded as a late response, and still prevents containment', async () => {
      const incident = db.addIncident({ createdAt: new Date(Date.now() - 10 * 60_000) });
      await service.acknowledge(incident.id, analyst);
      await service.sweep();

      expect(auditActions(incident.id)).toEqual([RESPONSE_AUDIT.ACKNOWLEDGED_AFTER_WINDOW]);
      expect(db.actionsFor(incident.id)).toHaveLength(0);
    });

    it('never undoes a successful containment: the action stays SUCCESS and the case stays CONTAINED', async () => {
      providerOutcome = 'SUCCESS';
      const incident = db.addIncident();
      await service.sweep();
      db.incidents.get(incident.id)!.status = 'CONTAINED'; // what containIfIsolated does on SUCCESS

      const result = await service.acknowledge(incident.id, analyst);

      expect(db.actionsFor(incident.id)[0].outcome).toBe('SUCCESS');
      expect(db.incidents.get(incident.id)!.status).toBe('CONTAINED');
      expect(result.response.state).toBe('CONTAINMENT_SUCCEEDED');
      expect(result.response.acknowledgedAt).not.toBeNull();
    });

    it('is idempotent — a second acknowledgement writes no new audit row and keeps the first timestamp', async () => {
      const incident = db.addIncident({ createdAt: new Date(Date.now() - 60_000) });
      await service.acknowledge(incident.id, analyst);
      const first = db.incidents.get(incident.id)!.acknowledgedAt;
      const second = await service.acknowledge(incident.id, { ...analyst, email: 'other@mirqab.local' });

      expect(second.alreadyAcknowledged).toBe(true);
      expect(db.incidents.get(incident.id)!.acknowledgedAt).toBe(first);
      expect(auditActions(incident.id)).toHaveLength(1);
    });
  });

  describe('concurrency (real advisory-lock semantics)', () => {
    it('two scheduler replicas sweeping the same expired incident create exactly ONE containment action', async () => {
      const replicaA = service;
      const replicaB = await buildService();
      const incident = db.addIncident();

      await Promise.all([replicaA.sweep(), replicaB.sweep(), replicaA.sweep(), replicaB.sweep()]);

      expect(db.actionsFor(incident.id)).toHaveLength(1);
      expect(aiService.completeAutomatedIsolation).toHaveBeenCalledTimes(1);
      expect(auditActions(incident.id).filter((a) => a === RESPONSE_AUDIT.WINDOW_EXPIRED)).toHaveLength(1);
    });

    it('acknowledgement racing the sweep: exactly one outcome wins, never both an acknowledgement-before-containment AND a containment', async () => {
      const incident = db.addIncident();
      const replicaB = await buildService();

      await Promise.all([replicaB.sweep(), service.acknowledge(incident.id, analyst)]);

      const actions = db.actionsFor(incident.id);
      const record = db.incidents.get(incident.id)!;
      if (actions.length === 0) {
        // Acknowledgement got the lock first → containment never decided.
        expect(auditActions(incident.id)).toEqual([RESPONSE_AUDIT.ACKNOWLEDGED_AFTER_WINDOW]);
      } else {
        // Sweep got the lock first → exactly one action, ack recorded after it.
        expect(actions).toHaveLength(1);
        expect(record.acknowledgedAt.getTime()).toBeGreaterThanOrEqual(actions[0].createdAt.getTime());
      }
    });
  });

  describe('RBAC / organization scoping of the acknowledge endpoint', () => {
    it('is restricted to ADMIN, SECURITY_ANALYST, IT_TECHNICIAN and object-guarded by IncidentAccessGuard', () => {
      expect(Reflect.getMetadata(ROLES_KEY, AiController)).toEqual([
        Role.ADMIN,
        Role.SECURITY_ANALYST,
        Role.IT_TECHNICIAN,
      ]);
      expect(Reflect.getMetadata(GUARDS_METADATA, AiController)).toContain(IncidentAccessGuard);
    });

    it('IncidentAccessGuard denies acknowledging another organization’s incident, and another department’s for IT_TECHNICIAN', async () => {
      const prisma = {
        incident: { findUnique: jest.fn().mockResolvedValue({ departmentId: 'dept-2', organizationId: 'org-1' }) },
      };
      const guard = new IncidentAccessGuard(prisma as never, { log: jest.fn() } as never);
      const context = (user: AuthenticatedUser) =>
        ({ switchToHttp: () => ({ getRequest: () => ({ params: { id: 'incident-x' }, user }) }) }) as never;

      await expect(guard.canActivate(context(analyst))).rejects.toBeInstanceOf(ForbiddenException);

      prisma.incident.findUnique.mockResolvedValue({ departmentId: 'dept-1', organizationId: 'org-2' });
      await expect(
        guard.canActivate(context({ ...analyst, role: Role.SECURITY_ANALYST })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('the scheduler', () => {
    it('AutoResponsePolicyService only delegates to ResponseSlaService.sweep — no other containment path exists', async () => {
      const responseSla = { sweep: jest.fn().mockResolvedValue(undefined) };
      const scheduler = new AutoResponsePolicyService(responseSla as never);
      await scheduler.sweep();
      expect(responseSla.sweep).toHaveBeenCalledTimes(1);
      const methods = Object.getOwnPropertyNames(AutoResponsePolicyService.prototype);
      expect(methods.sort()).toEqual(['constructor', 'sweep']);
    });
  });
});
