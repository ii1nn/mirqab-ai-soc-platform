import {
  EventSource,
  IncidentActionOutcome,
  IncidentActionType,
  IncidentStatus,
  Prisma,
  PrismaClient,
  Severity,
} from '@prisma/client';
import {
  ACKNOWLEDGEMENT_AUDIT_PREFIXES,
  AUTOMATED_ISOLATION_ACTORS,
  RESPONSE_AUDIT,
  RESPONSE_WINDOW_MS,
  RESPONSE_WINDOW_SEVERITIES,
} from './response-sla.constants';

/**
 * Pure response-window logic shared by the enforcement side
 * (ResponseSlaService.sweep, which re-evaluates it inside an advisory-locked
 * transaction) and the read side (AiService's history/investigation
 * payloads). Keeping one implementation is what guarantees the UI can never
 * show a state the scheduler would disagree with.
 */

export type ResponseState =
  | 'NOT_APPLICABLE'
  | 'WAITING_RESPONSE'
  | 'ACKNOWLEDGED'
  | 'WINDOW_EXPIRED'
  | 'CONTAINMENT_PENDING'
  | 'CONTAINMENT_SUCCEEDED'
  | 'CONTAINMENT_FAILED';

export type ContainmentBlockReason =
  // Preconditions — the incident never reaches a containment decision.
  | 'SEVERITY_NOT_ELIGIBLE'
  | 'NOT_OPEN'
  | 'ACKNOWLEDGED'
  | 'NO_DEVICE'
  | 'NO_ORGANIZATION'
  | 'ALREADY_ATTEMPTED'
  | 'WINDOW_OPEN'
  // Decision-time blocks — the window expired unanswered, but containment
  // must still not run.
  | 'SIMULATED'
  | 'POLICY_DISABLED'
  | 'PROVIDER_UNAVAILABLE';

export interface ResponseSubject {
  createdAt: Date;
  acknowledgedAt: Date | null;
  status: IncidentStatus;
  severity: Severity;
  deviceId: string | null;
  organizationId: string | null;
  ingestSource: EventSource;
}

export interface ResponseActionLike {
  id: string;
  type: IncidentActionType;
  outcome: IncidentActionOutcome;
  performedBy: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContainmentContext {
  now: Date;
  policyEnabled: boolean;
  providerAvailable: boolean;
  /** ingestSource === SIMULATION, or the database's `isSimulated` flag. */
  simulated: boolean;
}

export interface ContainmentEvaluation {
  eligible: boolean;
  reason: ContainmentBlockReason | null;
  /** True once the incident has reached the containment decision point: the
   * window expired with no acknowledgement on an open, device-bound,
   * organization-owned HIGH/CRITICAL incident with no prior isolation. Only
   * then does the sweep record a (once-only) decision. */
  atDecisionPoint: boolean;
}

export function responseDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + RESPONSE_WINDOW_MS);
}

export function isResponseWindowApplicable(severity: Severity): boolean {
  return RESPONSE_WINDOW_SEVERITIES.has(severity);
}

export function isSimulatedIncident(subject: Pick<ResponseSubject, 'ingestSource'>, rawSimulatedFlag: boolean): boolean {
  return subject.ingestSource === EventSource.SIMULATION || rawSimulatedFlag;
}

/**
 * The one eligibility rule for automated containment. Order matters only for
 * which reason is reported; every condition must hold for `eligible`.
 */
export function evaluateContainmentEligibility(
  subject: ResponseSubject,
  actions: Pick<ResponseActionLike, 'type'>[],
  ctx: ContainmentContext,
): ContainmentEvaluation {
  const blocked = (reason: ContainmentBlockReason, atDecisionPoint = false): ContainmentEvaluation => ({
    eligible: false,
    reason,
    atDecisionPoint,
  });

  if (!isResponseWindowApplicable(subject.severity)) return blocked('SEVERITY_NOT_ELIGIBLE');
  if (subject.status !== IncidentStatus.OPEN) return blocked('NOT_OPEN');
  if (subject.acknowledgedAt) return blocked('ACKNOWLEDGED');
  if (!subject.deviceId) return blocked('NO_DEVICE');
  if (!subject.organizationId) return blocked('NO_ORGANIZATION');
  // One automated attempt per incident, ever: any existing isolation action
  // (PENDING, SUCCESS, or FAILED; analyst or automated) means containment
  // has already been attempted — automation never retries on its own.
  if (actions.some((action) => action.type === IncidentActionType.ISOLATE_DEVICE)) {
    return blocked('ALREADY_ATTEMPTED');
  }
  if (ctx.now.getTime() < responseDeadline(subject.createdAt).getTime()) return blocked('WINDOW_OPEN');

  if (ctx.simulated) return blocked('SIMULATED', true);
  if (!ctx.policyEnabled) return blocked('POLICY_DISABLED', true);
  if (!ctx.providerAvailable) return blocked('PROVIDER_UNAVAILABLE', true);
  return { eligible: true, reason: null, atDecisionPoint: true };
}

/** The isolation action that represents this incident's containment: the
 * automated attempt when one exists, otherwise the most recent isolation. */
export function pickContainmentAction<T extends ResponseActionLike>(actions: T[]): T | null {
  const isolations = actions
    .filter((action) => action.type === IncidentActionType.ISOLATE_DEVICE)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return isolations.find((action) => AUTOMATED_ISOLATION_ACTORS.has(action.performedBy)) ?? isolations[0] ?? null;
}

/** Facts only the AuditLog holds (no acknowledgedBy column, no decision
 * column — this phase adds no migration). */
export interface ResponseAuditFacts {
  acknowledgedBy: string | null;
  /** The once-only containment decision, when the sweep has already taken it. */
  decided: boolean;
  decisionReason: ContainmentBlockReason | null;
}

export const EMPTY_RESPONSE_AUDIT_FACTS: ResponseAuditFacts = {
  acknowledgedBy: null,
  decided: false,
  decisionReason: null,
};

export interface ResponseView {
  windowMs: number;
  applicable: boolean;
  state: ResponseState;
  detectedAt: Date;
  deadline: Date | null;
  serverNow: Date;
  remainingMs: number | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  respondedInMs: number | null;
  respondedWithinWindow: boolean | null;
  containment: {
    actionId: string;
    outcome: IncidentActionOutcome;
    automated: boolean;
    performedBy: string;
    requestedAt: Date;
    completedAt: Date | null;
    detail: string | null;
  } | null;
  automatedContainment: {
    policyEnabled: boolean;
    providerAvailable: boolean;
    eligible: boolean;
    blockedReason: ContainmentBlockReason | null;
  };
}

const CONTAINMENT_STATE: Record<IncidentActionOutcome, ResponseState> = {
  [IncidentActionOutcome.PENDING]: 'CONTAINMENT_PENDING',
  [IncidentActionOutcome.SUCCESS]: 'CONTAINMENT_SUCCEEDED',
  [IncidentActionOutcome.FAILED]: 'CONTAINMENT_FAILED',
};

/** The backend-authoritative response state returned to the UI. */
export function buildResponseView(
  subject: ResponseSubject,
  actions: ResponseActionLike[],
  ctx: ContainmentContext,
  facts: ResponseAuditFacts,
): ResponseView {
  const applicable = isResponseWindowApplicable(subject.severity);
  const deadline = applicable ? responseDeadline(subject.createdAt) : null;
  const isolation = pickContainmentAction(actions);

  const respondedInMs = subject.acknowledgedAt
    ? Math.max(0, subject.acknowledgedAt.getTime() - subject.createdAt.getTime())
    : null;

  // Automated containment is only ever decided for an UNacknowledged
  // incident (under the same lock acknowledgement takes), so an automated
  // isolation always precedes any acknowledgement — no timestamp comparison
  // needed. For an analyst's own isolation, the order is read from the
  // timestamps: acknowledging and then isolating is a normal investigation.
  const containmentLeads =
    isolation !== null &&
    (AUTOMATED_ISOLATION_ACTORS.has(isolation.performedBy) ||
      !subject.acknowledgedAt ||
      subject.acknowledgedAt.getTime() > isolation.createdAt.getTime());

  let state: ResponseState;
  if (!applicable) {
    state = 'NOT_APPLICABLE';
  } else if (isolation && containmentLeads) {
    // Containment happened before (or without) a response — the isolation
    // outcome is the headline. A response recorded afterwards is still
    // reported via acknowledgedAt/respondedInMs, never as reversing it.
    state = CONTAINMENT_STATE[isolation.outcome];
  } else if (subject.acknowledgedAt) {
    state = 'ACKNOWLEDGED';
  } else if (deadline && ctx.now.getTime() < deadline.getTime()) {
    state = 'WAITING_RESPONSE';
  } else {
    state = 'WINDOW_EXPIRED';
  }

  const evaluation = evaluateContainmentEligibility(subject, actions, ctx);
  // Once decided, the recorded decision is final — a policy/provider change
  // afterwards never makes an already-expired incident eligible again.
  const blockedReason = facts.decided
    ? (facts.decisionReason ?? (isolation ? 'ALREADY_ATTEMPTED' : evaluation.reason))
    : evaluation.reason;

  return {
    windowMs: RESPONSE_WINDOW_MS,
    applicable,
    state,
    detectedAt: subject.createdAt,
    deadline,
    serverNow: ctx.now,
    remainingMs: deadline ? deadline.getTime() - ctx.now.getTime() : null,
    acknowledgedAt: subject.acknowledgedAt,
    acknowledgedBy: facts.acknowledgedBy,
    respondedInMs,
    respondedWithinWindow: respondedInMs === null ? null : respondedInMs <= RESPONSE_WINDOW_MS,
    containment: isolation
      ? {
          actionId: isolation.id,
          outcome: isolation.outcome,
          automated: AUTOMATED_ISOLATION_ACTORS.has(isolation.performedBy),
          performedBy: isolation.performedBy,
          requestedAt: isolation.createdAt,
          completedAt: isolation.outcome === IncidentActionOutcome.PENDING ? null : isolation.updatedAt,
          detail: isolation.notes,
        }
      : null,
    automatedContainment: {
      policyEnabled: ctx.policyEnabled,
      providerAvailable: ctx.providerAvailable,
      eligible: !facts.decided && evaluation.eligible,
      blockedReason,
    },
  };
}

const DECISION_REASON_BY_AUDIT: Record<string, ContainmentBlockReason | null> = {
  [RESPONSE_AUDIT.CONTAINMENT_UNAVAILABLE]: 'PROVIDER_UNAVAILABLE',
  [RESPONSE_AUDIT.CONTAINMENT_POLICY_DISABLED]: 'POLICY_DISABLED',
  [RESPONSE_AUDIT.CONTAINMENT_SIMULATED]: 'SIMULATED',
  [RESPONSE_AUDIT.CONTAINMENT_REQUESTED]: null,
};

type AuditReader = Pick<PrismaClient, 'auditLog'> | Prisma.TransactionClient;

/**
 * Batch-derives who acknowledged each incident and whether the sweep has
 * already taken its once-only containment decision, from real AuditLog rows
 * only. The acknowledger is the earliest human (non-`system:*`) actor whose
 * audit entry is an acknowledgement or a status change — the two paths that
 * stamp Incident.acknowledgedAt.
 */
export async function loadResponseAuditFacts(
  client: AuditReader,
  incidentIds: string[],
): Promise<Map<string, ResponseAuditFacts>> {
  const facts = new Map<string, ResponseAuditFacts>();
  if (incidentIds.length === 0) return facts;

  const rows = await client.auditLog.findMany({
    where: {
      target: { in: incidentIds },
      OR: [
        { action: { in: [RESPONSE_AUDIT.WINDOW_EXPIRED, ...Object.keys(DECISION_REASON_BY_AUDIT)] } },
        ...ACKNOWLEDGEMENT_AUDIT_PREFIXES.map((prefix) => ({ action: { startsWith: prefix } })),
      ],
    },
    select: { target: true, actorEmail: true, action: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const row of rows) {
    if (!row.target) continue;
    const entry = facts.get(row.target) ?? { ...EMPTY_RESPONSE_AUDIT_FACTS };
    if (row.action === RESPONSE_AUDIT.WINDOW_EXPIRED) {
      entry.decided = true;
    } else if (row.action in DECISION_REASON_BY_AUDIT) {
      entry.decisionReason = entry.decisionReason ?? DECISION_REASON_BY_AUDIT[row.action];
    } else if (
      !entry.acknowledgedBy &&
      !row.actorEmail.startsWith('system:') &&
      ACKNOWLEDGEMENT_AUDIT_PREFIXES.some((prefix) => row.action.startsWith(prefix))
    ) {
      entry.acknowledgedBy = row.actorEmail;
    }
    facts.set(row.target, entry);
  }
  return facts;
}

type RawQueryClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

/** Cached per process: migrations only run at boot, before the app starts. */
let simulatedColumnPresent: boolean | undefined;

/** Test hook — forget the cached column check. */
export function resetSimulatedColumnCache(): void {
  simulatedColumnPresent = undefined;
}

/** Whether the drift-only `incidents."isSimulated"` column exists. It is
 * present in databases that applied migration 20260819064620 (whose folder
 * is no longer in the repo) and ABSENT in every fresh database built from
 * the repo's migrations — see the known drift. */
async function hasSimulatedColumn(client: RawQueryClient): Promise<boolean> {
  if (simulatedColumnPresent === undefined) {
    const rows = await client.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'incidents' AND column_name = 'isSimulated'
      ) AS present`;
    simulatedColumnPresent = rows[0]?.present === true;
  }
  return simulatedColumnPresent;
}

/** Reads the database's `isSimulated` column for a set of incidents, when
 * that column exists (it is not in schema.prisma — the known drift — so it
 * can only be read with raw SQL). When it does not exist, no incident can
 * carry that flag, and ingestSource === SIMULATION (always checked by
 * isSimulatedIncident) is the only simulation marker. Any other query error
 * still propagates, so the sweep fails closed rather than risk isolating a
 * simulation. */
export async function readSimulatedFlags(
  client: RawQueryClient,
  incidentIds: string[],
): Promise<Set<string>> {
  if (incidentIds.length === 0) return new Set();
  if (!(await hasSimulatedColumn(client))) return new Set();
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT id FROM incidents WHERE id = ANY(${incidentIds}::text[]) AND "isSimulated" = true`;
  return new Set(rows.map((row) => row.id));
}
