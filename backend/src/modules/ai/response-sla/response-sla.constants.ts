import { Severity } from '@prisma/client';

/**
 * The one authoritative incident response window. T0 is Incident.createdAt
 * (the detection time the rest of the system already exposes as
 * `detectedAt`); the deadline is always createdAt + RESPONSE_WINDOW_MS.
 * Replaces both the old severity-keyed 15/30-minute SLA and the 3-minute
 * similarity-gated "AI auto-response" window — there is no other timer
 * anywhere in the backend or frontend that can trigger containment.
 */
export const RESPONSE_WINDOW_MS = 5 * 60 * 1000;

/** Only these severities get a response window / automated containment at
 * all — MEDIUM/LOW incidents always wait for an analyst. */
export const RESPONSE_WINDOW_SEVERITIES: ReadonlySet<Severity> = new Set([
  Severity.HIGH,
  Severity.CRITICAL,
]);

/** Operator kill switch for automated containment, looked up by name.
 * Fail-closed: a missing row means automated containment is OFF (the seed
 * creates it at every boot, before the app starts). */
export const RESPONSE_WINDOW_POLICY_NAME = '5-Minute Response Window';

/** DEPRECATED — kept only so historical data stays interpretable. This row
 * still exists in the Policies table but nothing reads it for execution any
 * more; the 3-minute similarity-gated isolation path it controlled has been
 * removed (see ResponseSlaService). */
export const LEGACY_AI_AUTO_RESPONSE_POLICY_NAME = 'AI Auto-Response (3-Minute Isolation Window)';

/** Deterministic, rule-based actor — not an AI/LLM decision. */
export const AUTOMATED_CONTAINMENT_ACTOR = 'system:automated-containment';

/** Actors that performed automated isolation before this workflow existed —
 * recognized so historical automated actions are still labelled as
 * automated in the response state, never as an analyst's own action. */
export const AUTOMATED_ISOLATION_ACTORS: ReadonlySet<string> = new Set([
  AUTOMATED_CONTAINMENT_ACTOR,
  'system:auto-response-policy',
  'system:ai-auto-response',
]);

/** How many expired candidates one scheduler tick will process. */
export const RESPONSE_SWEEP_BATCH = 25;

/**
 * Exact AuditLog.action strings for every response-window transition. The
 * WINDOW_EXPIRED row doubles as the once-only "decision already taken"
 * marker: it is written in the same advisory-locked transaction as the
 * containment decision, so an incident can only ever be decided once.
 */
export const RESPONSE_AUDIT = {
  WINDOW_EXPIRED: 'Response window expired — no acknowledgement within 5 minutes',
  CONTAINMENT_REQUESTED:
    'Automated containment requested — ISOLATE_DEVICE (no response within the 5-minute window)',
  CONTAINMENT_UNAVAILABLE:
    'Automated containment unavailable: no endpoint-control provider configured.',
  CONTAINMENT_POLICY_DISABLED:
    'Automated containment not attempted: the "5-Minute Response Window" policy is disabled.',
  CONTAINMENT_SIMULATED:
    'Automated containment not attempted: simulated incident (real endpoint isolation is never triggered for simulations).',
  ACKNOWLEDGED_WITHIN_WINDOW: 'Acknowledged incident — response received within the 5-minute window',
  ACKNOWLEDGED_AFTER_WINDOW: 'Acknowledged incident — response received after the 5-minute window',
} as const;

/** Prefixes that identify the human who first responded to an incident —
 * the explicit acknowledge endpoint, or the pre-existing status-change path
 * (AiService.updateIncidentStatus), which also stamps acknowledgedAt. */
export const ACKNOWLEDGEMENT_AUDIT_PREFIXES = ['Acknowledged incident', 'Set incident status to'] as const;

/**
 * Notification.title carries a stable machine-readable kind code for the
 * notifications this workflow creates (the model has no separate "kind"
 * column and this phase adds no migration); Notification.body carries an
 * English fallback sentence. The frontend renders the localized text from
 * the structured incident fields, never from the stored body.
 */
export const NOTIFICATION_KIND_PREFIX = 'mirqab:';
export const NOTIFICATION_KINDS = {
  RESPONSE_REQUIRED: 'mirqab:response-required',
  CONTAINMENT_RESULT: 'mirqab:containment',
} as const;

export type ContainmentNotificationResult =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNAVAILABLE'
  | 'POLICY_DISABLED';
