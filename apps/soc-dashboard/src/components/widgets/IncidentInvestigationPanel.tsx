import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  Clock,
  Crosshair,
  Download,
  Fingerprint,
  GitBranch,
  History,
  Laptop2,
  Radar,
  ShieldOff,
  Sparkles,
  Terminal,
  Ticket as TicketIcon,
  Timer,
  TrendingUp,
  User,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Badge, SeverityBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LtrText } from '../ui/LtrText';
import { useAuthStore } from '../../store/auth.store';
import {
  useAgentDecisions,
  useApplyRecommended,
  useApproveIncidentAction,
  useIncidentHistory,
  useIndicators,
  useInvestigation,
  useLogIncidentAction,
  usePersistenceFindings,
  useRejectIncidentAction,
  useUpdateIncidentActionOutcome,
  useUpdateIncidentResolution,
} from '../../hooks/useInvestigation';
import { useAcknowledgeIncident, useUpdateIncidentStatus } from '../../hooks/useIncidents';
import { useLanguage } from '../../i18n/LanguageContext';
import {
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  formatResponseCountdown,
  formatSlaDuration,
} from '../../lib/format';
import { isResponseCountdownRunning, remainingResponseMs } from '../../lib/sla';
import { incidentsService } from '../../services/incidents.service';
import type {
  ComparisonDimension,
  Department,
  EventIngestSource,
  EvidenceItem,
  IncidentAction,
  IncidentActionType,
  IncidentInvestigation,
  IncidentStatus,
  ResponseWindow,
  SimilarIncidentEntry,
  VirtualDevice,
} from '../../types/domain';

const INSUFFICIENT_DATA = 'Insufficient data';

/** Character count above which a Relevant Evidence entry's text is shown
 * as a truncated preview with a Read more/Show less toggle, rather than in
 * full — never trims the underlying data, only the initial render. */
const EVIDENCE_PREVIEW_LENGTH = 160;

/** Where this evidence actually came from — real open-source dataset replay
 * vs. synthetic Simulation Mode traffic vs. a live agent vs. an ad-hoc
 * manual/test call. Shown explicitly so demo/synthetic data is never
 * presented as real dataset-derived evidence (see EventIngestSource). */
const PROVENANCE_LABEL: Record<EventIngestSource, string> = {
  OPEN_SOURCE_DATASET: 'Open-Source Dataset',
  SIMULATION: 'Simulation (synthetic)',
  LIVE_AGENT: 'Live Agent',
  MANUAL_TEST: 'Manual / Test',
};
const PROVENANCE_BADGE: Record<EventIngestSource, 'success' | 'warning' | 'info' | 'unknown'> = {
  OPEN_SOURCE_DATASET: 'success',
  SIMULATION: 'warning',
  LIVE_AGENT: 'info',
  MANUAL_TEST: 'unknown',
};
function provenanceText(source: EventIngestSource, datasetOrigin: string | null): string {
  const label = PROVENANCE_LABEL[source] ?? source;
  return datasetOrigin ? `${label} (${datasetOrigin})` : label;
}

/** Raw enum values (indicator type, persistence type, agent name) are
 * technical identifiers, not prose — shown as "Title Case" rather than
 * routed through the translation table like the action/outcome labels are. */
function formatLabel(value: string): string {
  return value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const ACTION_TYPES: IncidentActionType[] = [
  'isolate-device',
  'disable-account',
  'block-ip',
  'block-hash',
  'reset-password',
  'update-firewall',
  'kill-process',
  'remove-malware',
  'collect-forensics',
  'monitor-department',
];

const IMPACT_COLOR: Record<string, string> = {
  low: '#10B981',
  medium: '#FBBF24',
  high: '#F59E0B',
  critical: '#FF3B5C',
};

/** Status-advance progression reused from the case-closure workflow —
 * "Escalate" (open→investigating) is just this same real transition under
 * SOC-familiar wording; every later stage reuses it too. */
const NEXT_STATUS: Partial<Record<IncidentStatus, Exclude<IncidentStatus, 'open'>>> = {
  open: 'investigating',
  investigating: 'contained',
  contained: 'resolved',
  resolved: 'closed',
};
const NEXT_STATUS_LABEL: Record<Exclude<IncidentStatus, 'open'>, string> = {
  investigating: 'Escalate to Investigation',
  contained: 'Mark Contained',
  resolved: 'Resolve Incident',
  closed: 'Close Incident',
};

interface PanelProps {
  incidentId: string | null;
  departments: Department[];
  devices: VirtualDevice[];
  onClose: () => void;
  /** Opens straight into the isolate confirmation modal once this incident's
   * real device/action data has loaded — used by the Threat Map's "Isolate
   * Device" button so it lands on the exact same confirm-then-call flow as
   * the in-panel button, just pre-opened. Never bypasses the confirmation
   * or the real POST /ai/incidents/:id/actions call below. */
  autoOpenIsolateConfirm?: boolean;
}

export function IncidentInvestigationPanel({
  incidentId,
  departments,
  devices,
  onClose,
  autoOpenIsolateConfirm = false,
}: PanelProps) {
  const { t, dir } = useLanguage();
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const { data: history } = useIncidentHistory(incidentId);
  const { data: investigation, isLoading } = useInvestigation(incidentId);
  const { data: indicators } = useIndicators(incidentId);
  const { data: persistenceFindings } = usePersistenceFindings(incidentId);
  const { data: agentDecisions } = useAgentDecisions(incidentId);
  const applyRecommended = useApplyRecommended(incidentId);
  const logAction = useLogIncidentAction(incidentId);
  const updateOutcome = useUpdateIncidentActionOutcome(incidentId);
  const approveAction = useApproveIncidentAction(incidentId);
  const rejectAction = useRejectIncidentAction(incidentId);
  const updateResolution = useUpdateIncidentResolution(incidentId);
  const updateStatus = useUpdateIncidentStatus();
  const acknowledge = useAcknowledgeIncident();
  const queryClient = useQueryClient();
  // The visual countdown reaching 00:00 only asks the backend for its
  // authoritative state — it never acts on its own.
  const refreshResponseState = useCallback(() => {
    if (incidentId) {
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'history'] });
    }
  }, [incidentId, queryClient]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logType, setLogType] = useState<IncidentActionType>('isolate-device');
  const [logNotes, setLogNotes] = useState('');
  // AI-recommended actions can include high-impact ones (isolate, disable
  // account, reset credentials...) — require an explicit confirm step rather
  // than firing on a single click.
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [showIsolateConfirm, setShowIsolateConfirm] = useState(false);
  const [rootCause, setRootCause] = useState('');
  const [finalResolution, setFinalResolution] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  useEffect(() => {
    if (history) {
      setRootCause(history.rootCause ?? '');
      setFinalResolution(history.finalResolution ?? '');
      setLessonsLearned(history.lessonsLearned ?? '');
    }
  }, [history?.id]);

  function departmentName(id: string | null): string {
    return departments.find((dept) => dept.id === id)?.name ?? t('dashboard.unknownDepartment');
  }
  function deviceHostname(id: string | null): string {
    return devices.find((device) => device.id === id)?.hostname ?? t('dashboard.unknownDevice');
  }
  function actionLabel(type: IncidentActionType): string {
    return t(`investigation.actions.${type}`);
  }
  function outcomeLabel(outcome: IncidentAction['outcome']): string {
    return t(`investigation.outcomes.${outcome}`);
  }

  async function handleDownloadCaseReport() {
    if (!incidentId || !history) return;
    setDownloadError(false);
    setIsDownloadingReport(true);
    try {
      await incidentsService.downloadCaseReport(incidentId, history.caseId);
    } catch {
      setDownloadError(true);
    } finally {
      setIsDownloadingReport(false);
    }
  }

  // Set only when the backend actually resolved ISOLATE_DEVICE to PENDING.
  // Two real, distinct reasons collapse to the same bare `status: 'pending'`
  // — approvalStatus is what tells them apart:
  //  - 'pending-approval': an AI-recommended isolation awaiting analyst
  //    sign-off (see AiService.applyRecommended) — Wazuh may be fully
  //    configured, nothing has been attempted against it yet.
  //  - anything else ('not-required'): the analyst directly requested
  //    isolation and AiService.createIncidentAction found no automated
  //    endpoint-control provider configured, so this genuinely does need a
  //    manual out-of-band isolation + confirmation here.
  const pendingIsolation = history?.actionsTaken.find(
    (action) => action.actionType === 'ISOLATE_DEVICE' && action.status === 'pending',
  );
  const isolationAwaitingApproval = pendingIsolation?.approvalStatus === 'pending-approval';
  const isolationManualPending = pendingIsolation && !isolationAwaitingApproval;
  // Only surfaced when nothing more recent supersedes it (not currently
  // isolated, not currently pending) — a real prior attempt whose detail
  // text (whatever provider actually produced it — Wazuh or manual) is
  // shown honestly rather than assumed.
  const failedIsolation =
    !history?.isolated && !pendingIsolation
      ? history?.actionsTaken.find(
          (action) => action.actionType === 'ISOLATE_DEVICE' && action.status === 'failed',
        )
      : undefined;

  // ISOLATE_DEVICE must never be "applied" through applyRecommended's
  // bookkeeping-only path (it never calls EndpointControlService/Wazuh —
  // see AiService.applyRecommended) — it has to go through the SAME real
  // confirmation + execution flow a manually-clicked "Isolate Endpoint"
  // uses (confirmIsolation() -> logAction -> AiService.createIncidentAction
  // -> EndpointControlService), so "Apply Recommended Response" reroutes
  // into that existing flow instead of creating a second implementation.
  // Same eligibility check the auto-open effect below already uses (device
  // present, not already isolated/pending) — if isolation is recommended
  // but there's nothing left to confirm (already isolated/pending, or no
  // device on this incident), this falls through to the ordinary
  // applyRecommended flow for whatever other types remain, matching
  // pre-existing behavior for that edge case.
  const recommendedTypes = investigation?.recommendations.map((rec) => rec.type) ?? [];
  const isolateRecommended = recommendedTypes.includes('isolate-device');
  const isolateNeedsConfirmation =
    isolateRecommended && Boolean(history?.deviceId) && !history?.isolated && !pendingIsolation;
  const nonIsolateRecommendations = isolateRecommended
    ? (investigation?.recommendations.filter((rec) => rec.type !== 'isolate-device') ?? [])
    : (investigation?.recommendations ?? []);

  function handleApplyRecommendedClick() {
    if (isolateNeedsConfirmation) {
      setShowIsolateConfirm(true);
    } else {
      setShowApplyConfirm(true);
    }
  }

  // Threat Map's "Isolate Device" button lands here via autoOpenIsolateConfirm
  // instead of duplicating the modal/mutation on that page. Fires at most
  // once per incidentId — real device/action data must be loaded first, so
  // the button is only auto-opened when it would actually be enabled (a
  // device exists, nothing already isolated/pending) — never forces the
  // modal open over a disabled/inapplicable state.
  const autoOpenedForIncident = useRef<string | null>(null);
  useEffect(() => {
    if (!autoOpenIsolateConfirm || !incidentId || !history) return;
    if (autoOpenedForIncident.current === incidentId) return;
    autoOpenedForIncident.current = incidentId;
    if (history.deviceId && !history.isolated && !pendingIsolation) {
      setShowIsolateConfirm(true);
    }
  }, [autoOpenIsolateConfirm, incidentId, history, pendingIsolation]);

  function confirmIsolation() {
    // The backend — not this click — decides whether isolation succeeded.
    // See AiService.createIncidentAction: this only creates the request. The
    // outcome comes back SUCCESS/FAILED immediately if a real
    // EndpointControlService is configured, otherwise PENDING until the
    // analyst confirms the real-world result below.
    logAction.mutate(
      {
        type: 'isolate-device',
        notes: `Isolation requested by ${user?.email ?? 'analyst'} via the Incident Response panel`,
      },
      { onSuccess: () => setShowIsolateConfirm(false) },
    );
  }

  const nextStatus = history ? NEXT_STATUS[history.status] : undefined;
  const showResolutionForm = history?.status === 'resolved' || history?.status === 'closed';
  const foundingEvidence = history?.evidence.find((item) => item.correlationScore === null);
  const processCommandPairs = (persistenceFindings ?? [])
    .filter((finding) => finding.process || finding.command)
    .map((finding) => ({ process: finding.process, command: finding.command }));

  // Portal straight to document.body — this component renders inside
  // AppShell's page-transition <motion.div animate={{ y: 0 }}>, and any
  // non-zero `transform` on an ancestor (even a no-op translateY(0px), which
  // Framer Motion applies as a real inline style) creates a new containing
  // block for `position: fixed` descendants. Without the portal, "fixed
  // inset-0" on the backdrop below was actually resolving against that
  // ancestor's box (which starts below the Topbar), not the true viewport —
  // the visible symptom was a gap/"white strip" at the very top of the
  // screen where the backdrop never reached. Modal.tsx already uses this
  // exact same portal-to-body pattern for the identical reason.
  return createPortal(
    <AnimatePresence>
      {incidentId && (
        <>
          {/* Backdrop — covers the ENTIRE viewport (including the Sidebar
              and Topbar, both z-10) so the two windows read as a real modal
              layer above the whole app, not just above the content area.
              Deliberately viewport-based (inset-0), not content-area-based —
              no sidebar-width offset here, unlike an earlier version of this
              fix. bg-mirqab-surfaceElevated (not bg-black) so the backdrop
              is theme-reactive using an EXISTING token — dark mode value is
              a near-black navy (visually ~identical to the old bg-black/70),
              light mode value is white, giving a clean light backdrop
              instead of a muddy dark-on-light wash, with no new color
              introduced. A separate sibling layer, not a wrapper around the
              panels — backdrop-blur only ever blurs what's BEHIND the
              element it's applied to, so the panels (z-30, above this z-20
              backdrop) stay perfectly sharp with no special-casing needed.
              Click closes, same as Modal.tsx, so the app underneath can't
              be interacted with by accident. */}
          <motion.div
            key="incident-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 bg-mirqab-surfaceElevated/70 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            key="investigation-panel"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            // Follows the real app direction so flexbox `order` below
            // resolves against the true main-start/main-end edges — Response
            // (order-1) always lands at main-start, Investigation (order-2)
            // at main-end, correctly reversing with the language. Because
            // this is a real CSS `direction`, not just a class, the flip
            // happens entirely through `order`/`justify-between` below — the
            // container's own bounds don't need a dir-conditional at all
            // (see the plain lg:left-4/right-4 a few lines down).
            style={{ direction: dir }}
            className={clsx(
              // pointer-events-none: this container's own box spans the
              // FULL viewport width (its two children are only 380px each,
              // spaced apart by justify-between) — without this, its empty
              // middle "gap" region would sit above (z-30) and silently
              // block clicks meant for the backdrop underneath, even though
              // nothing is visibly rendered there. Each actual panel below
              // re-enables pointer-events-auto on itself.
              // inset-y-4 (16px top+bottom), not the old top-20: that offset
              // existed to clear the Topbar when this was a docked panel
              // beside interactive content. Now that the Topbar sits behind
              // the full-viewport backdrop (z-10 < 20) like everything else,
              // the windows can — and per the design should — use the same
              // small, symmetric gutter on every edge, like a real modal.
              'pointer-events-none fixed inset-x-4 inset-y-4 z-30 flex flex-col gap-4',
              // Viewport-based bounds (a small gutter off the raw screen
              // edge), deliberately NOT offset by the Sidebar's width —
              // this modal layer sits above the whole app (z-30 > Sidebar's
              // z-10), so the windows are meant to visually overlap the
              // Sidebar at whichever edge it occupies, not stop short of
              // it. Symmetric on purpose: `direction`+`order`+
              // `justify-between` above already puts Response/Investigation
              // on the correct physical side for the language, so this
              // outer box doesn't need its own dir-conditional too.
              'lg:inset-x-auto lg:left-4 lg:right-4 lg:flex-row lg:justify-between',
            )}
          >
            {/* WINDOW 1 — INCIDENT RESPONSE (primary): incident summary +
                response controls. Nothing analytical lives here — that's
                Window 2 beside it. Compact, fixed width — matches Window 2's
                footprint exactly rather than stretching. Ordered first in
                the DOM (top of the mobile stack, easiest to reach) and
                order-1 on desktop — always the panel adjacent to the
                Sidebar, on whichever edge the Sidebar occupies. */}
            <div
              style={{ direction: dir }}
              className="glass-panel order-1 pointer-events-auto flex min-h-0 flex-1 flex-col overflow-y-auto p-5 shadow-2xl lg:w-[380px] lg:flex-none"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-mirqab-accent" />
                  <h2 className="text-lg font-semibold text-white">Incident Response</h2>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {isLoading && !history && (
                <p className="text-sm text-slate-500">{t('common.loading')}</p>
              )}

              {history && (
                <div className="space-y-5">
                  {/* INCIDENT */}
                  <section>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <SeverityBadge severity={history.severity} />
                      <div className="flex items-center gap-1.5">
                        <Badge status="unknown">{history.status}</Badge>
                        {history.isolated && <Badge status="danger">Isolated</Badge>}
                      </div>
                    </div>
                    <div className="mb-2">
                      <Badge status={PROVENANCE_BADGE[history.ingestSource] ?? 'unknown'}>
                        {provenanceText(history.ingestSource, history.datasetOrigin)}
                      </Badge>
                    </div>
                    <h3 className="text-base font-semibold text-white">{history.title}</h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <Row label="Case ID" value={history.caseId} mono />
                      <Row label="Incident ID" value={history.id} mono />
                      <Row
                        icon={Laptop2}
                        label="Device / Endpoint"
                        value={history.deviceName ?? INSUFFICIENT_DATA}
                      />
                      <Row
                        icon={Building2}
                        label="Department"
                        value={history.departmentName ?? INSUFFICIENT_DATA}
                      />
                      <Row
                        icon={User}
                        label="User"
                        value={history.userAccount ?? INSUFFICIENT_DATA}
                      />
                      <Row label="Detection time" value={formatDateTime(history.detectedAt)} />
                      <Row
                        label="Confidence / Risk"
                        value={
                          investigation
                            ? `${investigation.riskPrediction.confidence}% confidence · ${t(
                                `investigation.impact.${investigation.riskPrediction.businessImpact}`,
                              )} business impact`
                            : INSUFFICIENT_DATA
                        }
                      />
                      {history.isolated && (
                        <Row
                          label="Isolated"
                          value={`${history.isolatedAt ? formatDateTime(history.isolatedAt) : ''}${history.isolatedBy ? ` · ${history.isolatedBy}` : ''}`}
                        />
                      )}
                    </dl>
                  </section>

                  <ResponseWindowCard
                    response={history.response}
                    status={history.status}
                    onAcknowledge={() => acknowledge.mutate(history.id)}
                    acknowledging={acknowledge.isPending}
                    acknowledgeFailed={acknowledge.isError}
                    onReview={() =>
                      document
                        .getElementById(`incident-review-${history.id}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                    onDeadlineReached={refreshResponseState}
                    t={t}
                  />

                  {/* RESPONSE ACTIONS */}
                  <section className="space-y-2 border-t border-white/5 pt-4">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Response Actions
                    </h3>

                    {isolationAwaitingApproval && (
                      <div className="rounded-xl2 border border-mirqab-accent/30 bg-mirqab-accent/5 p-3 text-xs text-slate-300">
                        <p>{t('investigation.isolation.awaitingApproval')}</p>
                      </div>
                    )}

                    {isolationManualPending && (
                      <div className="rounded-xl2 border border-mirqab-warning/40 bg-mirqab-warning/10 p-3 text-xs text-slate-300">
                        <p className="mb-1 font-medium text-slate-100">
                          {t('investigation.isolation.pending')}
                        </p>
                        <p className="mb-2">
                          {pendingIsolation?.approvalStatus === 'approved'
                            ? t('investigation.isolation.approvedManualConfirmRequired')
                            : t('investigation.isolation.manualRequired')}
                        </p>
                        {updateOutcome.isError && (
                          <p className="mb-2 text-mirqab-danger">
                            Couldn't record the result — please try again.
                          </p>
                        )}
                        <div className="flex gap-2">
                          <Button
                            variant="danger-solid"
                            size="sm"
                            disabled={updateOutcome.isPending}
                            onClick={() =>
                              updateOutcome.mutate({
                                actionId: pendingIsolation!.id,
                                outcome: 'success',
                              })
                            }
                          >
                            {updateOutcome.isPending ? 'Confirming…' : 'Confirm isolation succeeded'}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={updateOutcome.isPending}
                            onClick={() =>
                              updateOutcome.mutate({
                                actionId: pendingIsolation!.id,
                                outcome: 'failed',
                              })
                            }
                          >
                            Mark failed
                          </Button>
                        </div>
                      </div>
                    )}

                    {failedIsolation && (
                      <div className="rounded-xl2 border border-mirqab-danger/40 bg-mirqab-danger/10 p-3 text-xs text-slate-300">
                        <p className="mb-1 font-medium text-mirqab-danger">
                          {t('investigation.isolation.failed')}
                        </p>
                        {failedIsolation.result && <p>{failedIsolation.result}</p>}
                      </div>
                    )}

                    {history.deviceId && (
                      <Button
                        variant="danger-solid"
                        disabled={
                          history.isolated || Boolean(pendingIsolation) || logAction.isPending
                        }
                        onClick={() => setShowIsolateConfirm(true)}
                      >
                        <ShieldOff className="h-4 w-4" />
                        {history.isolated
                          ? 'Already Isolated'
                          : isolationAwaitingApproval
                            ? t('investigation.isolation.awaitingApprovalShort')
                            : isolationManualPending
                              ? t('investigation.isolation.pending')
                              : logAction.isPending
                                ? 'Isolating…'
                                : 'Isolate Endpoint'}
                      </Button>
                    )}
                    {/* The mutation is a single request/response that only
                        resolves once the real outcome (SUCCESS/FAILED/PENDING)
                        is already known — see AiService.createIncidentAction —
                        so this is shown for the brief in-flight window only,
                        never left standing once a result exists. */}
                    {logAction.isPending && (
                      <p className="text-xs text-slate-400">{t('investigation.isolation.requested')}</p>
                    )}
                    {logAction.isError && (
                      <p className="text-xs text-mirqab-danger">
                        Couldn't submit the isolation request — please try again.
                      </p>
                    )}

                    {nextStatus && (
                      <Button
                        variant="secondary"
                        disabled={updateStatus.isPending}
                        onClick={() =>
                          incidentId && updateStatus.mutate({ id: incidentId, status: nextStatus })
                        }
                      >
                        {NEXT_STATUS_LABEL[nextStatus]}
                      </Button>
                    )}

                    <Button
                      variant="secondary"
                      disabled={logAction.isPending}
                      onClick={() => logAction.mutate({ type: 'collect-forensics' })}
                    >
                      <Fingerprint className="h-4 w-4" />
                      Collect Evidence
                    </Button>

                    <Button
                      variant="secondary"
                      disabled={!history.ticketNumber}
                      onClick={() => {
                        navigate('/tickets');
                        onClose();
                      }}
                    >
                      <TicketIcon className="h-4 w-4" />
                      {history.ticketNumber
                        ? `Open Ticket ${history.ticketNumber}`
                        : 'No ticket for this incident'}
                    </Button>

                    <Button
                      variant="secondary"
                      disabled={isDownloadingReport}
                      onClick={handleDownloadCaseReport}
                    >
                      <Download className="h-4 w-4" />
                      {isDownloadingReport ? 'Generating report…' : 'Download Case Report (PDF)'}
                    </Button>
                    {downloadError && (
                      <p className="text-xs text-mirqab-danger">
                        Couldn't generate the report — please try again.
                      </p>
                    )}
                  </section>

                  {/* Response log — every recorded action against this case,
                      AI-recommended ones tagged and gated behind approval. */}
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <History className="h-3.5 w-3.5" />
                      {t('investigation.responseLog')}
                    </h3>
                    {!investigation || investigation.ownActions.length === 0 ? (
                      <p className="mb-2 text-xs text-slate-500">{t('investigation.noOwnActions')}</p>
                    ) : (
                      <ul className="mb-3 space-y-1.5">
                        {investigation.ownActions.map((action) => (
                          <ActionRow
                            key={action.id}
                            action={action}
                            actionLabel={actionLabel}
                            outcomeLabel={outcomeLabel}
                            t={t}
                            onMark={(outcome) =>
                              updateOutcome.mutate({ actionId: action.id, outcome })
                            }
                            onApprove={() => approveAction.mutate(action.id)}
                            onReject={() => rejectAction.mutate({ actionId: action.id })}
                            approvePending={approveAction.isPending}
                            rejectPending={rejectAction.isPending}
                          />
                        ))}
                      </ul>
                    )}

                    <div className="flex flex-col gap-2 rounded-xl2 border border-white/5 bg-white/5 p-3">
                      <select
                        value={logType}
                        onChange={(event) => setLogType(event.target.value as IncidentActionType)}
                        className="rounded-lg border border-white/10 bg-mirqab-primary/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-mirqab-accent/50"
                      >
                        {ACTION_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {actionLabel(type)}
                          </option>
                        ))}
                      </select>
                      <input
                        value={logNotes}
                        onChange={(event) => setLogNotes(event.target.value)}
                        placeholder={t('investigation.notesPlaceholder')}
                        className="rounded-lg border border-white/10 bg-mirqab-primary/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-mirqab-accent/50"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={logAction.isPending}
                        onClick={() => {
                          logAction.mutate({ type: logType, notes: logNotes || undefined });
                          setLogNotes('');
                        }}
                      >
                        {t('investigation.logAction')}
                      </Button>
                    </div>
                  </section>

                  {showResolutionForm && (
                    <section className="space-y-3 border-t border-white/5 pt-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('incidentPanel.resolutionNotes')}
                      </h3>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">
                          {t('incidentPanel.rootCause')}
                        </label>
                        <textarea
                          value={rootCause}
                          onChange={(event) => setRootCause(event.target.value)}
                          rows={2}
                          className="w-full rounded-lg border border-white/10 bg-mirqab-primary/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-mirqab-accent/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">
                          {t('incidentPanel.finalResolution')}
                        </label>
                        <textarea
                          value={finalResolution}
                          onChange={(event) => setFinalResolution(event.target.value)}
                          rows={2}
                          className="w-full rounded-lg border border-white/10 bg-mirqab-primary/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-mirqab-accent/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">
                          {t('incidentPanel.lessonsLearned')}
                        </label>
                        <textarea
                          value={lessonsLearned}
                          onChange={(event) => setLessonsLearned(event.target.value)}
                          rows={2}
                          className="w-full rounded-lg border border-white/10 bg-mirqab-primary/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-mirqab-accent/50"
                        />
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={updateResolution.isPending}
                        onClick={() =>
                          updateResolution.mutate({ rootCause, finalResolution, lessonsLearned })
                        }
                      >
                        {t('incidentPanel.saveResolution')}
                      </Button>
                    </section>
                  )}
                </div>
              )}
            </div>

            {/* WINDOW 2 — INCIDENT INVESTIGATION / WHAT HAPPENED (secondary):
                everything analytical — what happened, attack progression,
                evidence, security analysis, AI analysis, similar incidents,
                and suggested solutions (including the one actionable current
                recommendation). Visually distinct from Window 1 (its own
                glass-panel card), never a second place to trigger the same
                response actions Window 1 already owns. Same compact fixed
                width as Window 1 — long content scrolls inside it (or, for
                individual long text fields, collapses behind Read more/Show
                less — see ExpandableText) rather than growing the panel.
                Second in the DOM (bottom of the mobile stack) and order-2 on
                desktop — always the opposite edge from the Sidebar/Response
                pair, on whichever side that ends up being. */}
            <div
              style={{ direction: dir }}
              className="glass-panel order-2 pointer-events-auto flex min-h-0 flex-1 flex-col overflow-y-auto p-5 shadow-2xl lg:w-[380px] lg:flex-none"
            >
              <div className="mb-4 flex items-center gap-2">
                <Crosshair className="h-5 w-5 text-mirqab-accent" />
                <h2 className="text-lg font-semibold text-white">Incident Investigation</h2>
              </div>

              {isLoading && !history && (
                <p className="text-sm text-slate-500">{t('common.loading')}</p>
              )}

              {history && (
                <div className="space-y-5">
                  {/* WHAT HAPPENED */}
                  <section id={`incident-review-${history.id}`} className="scroll-mt-4">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <GitBranch className="h-3.5 w-3.5" />
                      What Happened
                    </h3>
                    <div className="space-y-2.5 rounded-xl2 border border-white/5 bg-white/5 p-3 text-xs text-slate-300">
                      <p>
                        <span className="text-slate-500">Attack type: </span>
                        {history.mitreTechniqueId} {history.attackType}
                      </p>
                      <p>
                        <ExpandableText text={history.description} t={t} />
                      </p>
                      <p>
                        <span className="text-slate-500">How it started: </span>
                        {foundingEvidence?.sourceExcerpt ?? INSUFFICIENT_DATA}
                      </p>
                      <p>
                        <span className="text-slate-500">Source: </span>
                        {history.source ?? INSUFFICIENT_DATA}
                        <span className="text-slate-500"> · Destination: </span>
                        {history.destination ?? INSUFFICIENT_DATA}
                      </p>
                      <p className="flex flex-wrap items-center gap-1 text-slate-500">
                        <Terminal className="h-3 w-3" /> Process / command:
                        {processCommandPairs.length === 0 ? (
                          <span className="text-slate-300"> {INSUFFICIENT_DATA}</span>
                        ) : (
                          processCommandPairs.map((pair, index) => (
                            <span key={index} className="font-mono text-[11px] text-slate-300">
                              {[pair.process, pair.command].filter(Boolean).join(' ')}
                              {index < processCommandPairs.length - 1 ? ',' : ''}
                            </span>
                          ))
                        )}
                      </p>
                    </div>

                    <p className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Attack progression
                    </p>
                    {history.timeline.length === 0 ? (
                      <p className="text-xs text-slate-500">{INSUFFICIENT_DATA}</p>
                    ) : (
                      <ol className="space-y-1.5 border-s border-white/10 ps-3">
                        {history.timeline.map((entry) => (
                          <li key={entry.id} className="text-xs">
                            <p className="text-slate-300">{entry.event}</p>
                            <p className="text-[10px] text-slate-500">
                              {formatDateTime(entry.timestamp)}
                              {entry.description && (
                                <ExpandableText text={entry.description} t={t} prefix=" · " />
                              )}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}

                    <p className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Relevant evidence ({history.evidenceCount})
                    </p>
                    {history.evidence.length === 0 ? (
                      <p className="text-xs text-slate-500">{INSUFFICIENT_DATA}</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {history.evidence.map((item) => (
                          <EvidenceListItem key={item.id} item={item} t={t} />
                        ))}
                      </ul>
                    )}
                  </section>

                  {/* SECURITY ANALYSIS */}
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <Crosshair className="h-3.5 w-3.5" />
                      Security Analysis
                    </h3>

                    <div className="mb-3 rounded-xl2 border border-white/5 bg-white/5 p-2.5 text-xs text-slate-300">
                      <p>
                        <span className="text-slate-500">MITRE tactic: </span>
                        {history.attackCategory}
                      </p>
                      <p>
                        <span className="text-slate-500">MITRE technique: </span>
                        {history.mitreTechniqueId} {history.mitreTechniqueName}
                      </p>
                    </div>

                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t('investigation.indicators')} — IOC / IOA / C2
                    </p>
                    {!indicators || indicators.length === 0 ? (
                      <p className="mb-3 text-xs text-slate-500">{t('investigation.noIndicators')}</p>
                    ) : (
                      <ul className="mb-3 space-y-1.5">
                        {indicators.map((indicator) => (
                          <li
                            key={indicator.id}
                            className="rounded-xl border border-white/5 bg-white/5 px-2.5 py-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-mono text-xs text-slate-200">
                                {indicator.value}
                              </span>
                              <Badge status={indicator.category === 'ioc' ? 'danger' : 'warning'}>
                                {indicator.category.toUpperCase()}
                              </Badge>
                            </div>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {formatLabel(indicator.type)}
                              {indicator.subtype ? ` · ${indicator.subtype}` : ''}
                              {indicator.mitreTechniqueId ? ` · ${indicator.mitreTechniqueId}` : ''}
                              {' · '}
                              {t('investigation.confidence')} {indicator.confidence}%
                            </p>
                            {indicator.description && (
                              <p className="mt-0.5 text-[10px] text-slate-500">
                                <ExpandableText text={indicator.description} t={t} />
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t('investigation.persistenceFindings')}
                    </p>
                    {!persistenceFindings || persistenceFindings.length === 0 ? (
                      <p className="mb-3 text-xs text-slate-500">
                        {t('investigation.noPersistenceFindings')}
                      </p>
                    ) : (
                      <ul className="mb-3 space-y-1.5">
                        {persistenceFindings.map((finding) => (
                          <li
                            key={finding.id}
                            className="rounded-xl border border-white/5 bg-white/5 px-2.5 py-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-medium text-slate-200">
                                {formatLabel(finding.type)}
                              </span>
                              <SeverityBadge severity={finding.risk} />
                            </div>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {finding.mitreTechniqueId} · {finding.mitreTechniqueName}
                              {finding.endpoint ? ` · ${finding.endpoint}` : ''}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              <ExpandableText text={finding.evidenceText} t={t} />
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}

                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      AI analysis
                    </p>
                    {investigation && (
                      <div className="mb-3 grid grid-cols-2 gap-2">
                        <RiskTile
                          label={t('investigation.lateralMovement')}
                          value={
                            investigation.riskPrediction.lateralMovementProbability !== null
                              ? `${investigation.riskPrediction.lateralMovementProbability}%`
                              : INSUFFICIENT_DATA
                          }
                        />
                        <RiskTile
                          label={t('investigation.spreadTime')}
                          value={
                            investigation.riskPrediction.estimatedSpreadTimeMs !== null
                              ? formatDuration(investigation.riskPrediction.estimatedSpreadTimeMs)
                              : INSUFFICIENT_DATA
                          }
                        />
                        <RiskTile
                          label={t('investigation.affectedDevices')}
                          value={
                            investigation.riskPrediction.estimatedAffectedDevices !== null
                              ? String(investigation.riskPrediction.estimatedAffectedDevices)
                              : INSUFFICIENT_DATA
                          }
                        />
                        <RiskTile
                          label={t('investigation.businessImpact')}
                          value={t(
                            `investigation.impact.${investigation.riskPrediction.businessImpact}`,
                          )}
                          color={IMPACT_COLOR[investigation.riskPrediction.businessImpact]}
                        />
                      </div>
                    )}
                    {!agentDecisions || agentDecisions.length === 0 ? (
                      <p className="text-xs text-slate-500">{t('investigation.noAgentDecisions')}</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {agentDecisions.map((decision) => (
                          <li
                            key={decision.id}
                            className="rounded-xl border border-white/5 bg-white/5 px-2.5 py-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-slate-200">
                                {formatLabel(decision.agent)}
                              </span>
                              {decision.confidence !== null && (
                                <span className="text-[10px] text-slate-500">
                                  {t('investigation.confidence')} {decision.confidence}%
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[10px] text-mirqab-accent">{decision.action}</p>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              <ExpandableText text={decision.summary} t={t} />
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {/* SUGGESTED SOLUTIONS — headline summary of the best
                      historical match + the new confidence-gated AI
                      auto-response window. Real data only, never invented.
                      Purely informational — the only "Apply" action in this
                      panel lives in the RECOMMENDATIONS section below, so the
                      same recommended action is never presented as two
                      separate actionable entry points. */}
                  {investigation && (
                    <SuggestedSolutionsCard
                      investigation={investigation}
                      actionLabel={actionLabel}
                      t={t}
                    />
                  )}

                  {/* SIMILAR INCIDENTS — real Incident Memory / historical
                      data (AiService.getInvestigation), never invented. */}
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <Radar className="h-3.5 w-3.5" />
                      {t('investigation.similarIncidents')}
                    </h3>
                    {!investigation || investigation.similar.length === 0 ? (
                      <p className="text-xs text-slate-500">{t('investigation.noSimilar')}</p>
                    ) : (
                      <ul className="space-y-2">
                        {investigation.similar.map((entry) => (
                          <SimilarIncidentCard
                            key={entry.incident.id}
                            entry={entry}
                            expanded={expandedId === entry.incident.id}
                            onToggle={() =>
                              setExpandedId((current) =>
                                current === entry.incident.id ? null : entry.incident.id,
                              )
                            }
                            departmentName={departmentName}
                            deviceHostname={deviceHostname}
                            actionLabel={actionLabel}
                            outcomeLabel={outcomeLabel}
                            t={t}
                          />
                        ))}
                      </ul>
                    )}
                  </section>

                  {/* RECOMMENDATIONS — the one actionable current
                      recommendation for this incident. */}
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <TrendingUp className="h-3.5 w-3.5" />
                      {t('investigation.recommendationsHeading')}
                    </h3>
                    {!investigation || investigation.recommendations.length === 0 ? (
                      <p className="text-xs text-slate-500">{t('investigation.noRecommendations')}</p>
                    ) : (
                      <>
                        <p className="mb-1 text-[10px] text-slate-500">
                          {t('investigation.recommendationSourceRuleBased')}
                        </p>
                        <p className="mb-2 text-[10px] text-slate-500">
                          {t('investigation.currentRecommendationNote')}
                        </p>
                        <ul className="space-y-1.5">
                          {investigation.recommendations.map((rec) => (
                            <li
                              key={rec.type}
                              className="rounded-xl2 border border-mirqab-success/20 bg-mirqab-success/5 p-2.5"
                            >
                              <div className="flex items-center gap-2">
                                <Check className="h-3.5 w-3.5 shrink-0 text-mirqab-success" />
                                <span className="text-sm font-medium text-slate-100">
                                  {actionLabel(rec.type)}
                                </span>
                              </div>
                              <p className="mt-1 ps-5 text-[11px] text-slate-500">
                                <ExpandableText text={rec.reason} t={t} />
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 ps-5">
                                <Badge status={rec.riskLevel === 'high' ? 'danger' : 'info'}>
                                  {t('investigation.riskLevelLabel')}:{' '}
                                  {t(`investigation.riskLevel.${rec.riskLevel}`)}
                                </Badge>
                                <Badge status="unknown">
                                  {rec.sufficientData
                                    ? `${t('investigation.confidence')} ${rec.confidencePercent}%`
                                    : t('investigation.insufficientHistoricalData')}
                                </Badge>
                                <Badge status={rec.humanApprovalRequired ? 'warning' : 'success'}>
                                  {rec.humanApprovalRequired
                                    ? t('investigation.humanApprovalRequired')
                                    : t('investigation.humanApprovalNotRequired')}
                                </Badge>
                              </div>
                            </li>
                          ))}
                        </ul>
                        <Button
                          className="mt-3 w-full"
                          disabled={
                            applyRecommended.isPending ||
                            (nonIsolateRecommendations.length === 0 && !isolateNeedsConfirmation)
                          }
                          onClick={handleApplyRecommendedClick}
                        >
                          {applyRecommended.isPending
                            ? t('investigation.applying')
                            : t('investigation.applyRecommended')}
                        </Button>
                      </>
                    )}
                  </section>
                </div>
              )}
            </div>
          </motion.div>

          <AnimatePresence>
            {showIsolateConfirm && history && (
              <motion.div
                key="isolate-confirm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="glass-panel w-full max-w-sm p-5"
                >
                  <div className="mb-3 flex items-center gap-2 text-mirqab-danger">
                    <AlertTriangle className="h-5 w-5" />
                    <h3 className="text-base font-semibold text-white">Confirm isolation</h3>
                  </div>
                  <p className="mb-4 text-sm text-slate-300">
                    Isolate{' '}
                    <span className="font-medium text-slate-100">
                      {history.deviceName ?? 'this device'}
                    </span>{' '}
                    ({departmentName(history.departmentId)})? Only this endpoint is affected — the
                    rest of the department stays connected. Recorded against case {history.caseId}.
                  </p>
                  {/* Matches DevicePanel.tsx's identical isolationFailed handling for
                      its own isolate flow — a rejected request (network error, an
                      expired/invalid session, etc.) must not leave this modal sitting
                      open with no explanation and a button that just silently
                      re-enables. The backend result is still authoritative either
                      way: a resolved-but-FAILED outcome closes this modal via
                      onSuccess below and shows up in the actions list instead. */}
                  {logAction.isError && (
                    <p className="mb-3 text-xs text-mirqab-danger">
                      Couldn't submit the isolation request — please try again.
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="danger-solid"
                      disabled={logAction.isPending}
                      onClick={confirmIsolation}
                    >
                      {logAction.isPending ? 'Isolating…' : 'Yes, isolate this endpoint'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setShowIsolateConfirm(false)}
                      disabled={logAction.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showApplyConfirm && investigation && (
              <motion.div
                key="apply-recommended-confirm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="glass-panel w-full max-w-sm p-5"
                >
                  <div className="mb-3 flex items-center gap-2 text-mirqab-danger">
                    <AlertTriangle className="h-5 w-5" />
                    <h3 className="text-base font-semibold text-white">
                      {t('investigation.applyRecommendedConfirmTitle')}
                    </h3>
                  </div>
                  <p className="mb-2 text-sm text-slate-300">
                    {t('investigation.applyRecommendedConfirmBody')}
                  </p>
                  <ul className="mb-4 space-y-1 text-xs text-slate-400">
                    {nonIsolateRecommendations.map((rec) => (
                      <li key={rec.type}>&bull; {actionLabel(rec.type)}</li>
                    ))}
                  </ul>
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="danger-solid"
                      disabled={applyRecommended.isPending || nonIsolateRecommendations.length === 0}
                      onClick={() =>
                        applyRecommended.mutate(
                          nonIsolateRecommendations.map((r) => r.type),
                          { onSuccess: () => setShowApplyConfirm(false) },
                        )
                      }
                    >
                      {applyRecommended.isPending
                        ? t('investigation.applying')
                        : t('investigation.applyRecommendedConfirmAction')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setShowApplyConfirm(false)}
                      disabled={applyRecommended.isPending}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Row({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon?: typeof User;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/5 pb-1.5">
      <dt className="flex items-center gap-1.5 text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </dt>
      <dd className={clsx('truncate text-end text-slate-200', mono && 'font-mono text-xs')}>
        {value}
      </dd>
    </div>
  );
}

/**
 * One "Relevant Evidence" row. Real API data only — never trims what's
 * stored, only what's initially rendered: text at or under
 * EVIDENCE_PREVIEW_LENGTH shows in full with no toggle; longer text starts
 * collapsed to a preview with a Read more/Show less button that reveals
 * the exact same `item.sourceExcerpt` string, unmodified.
 */
function EvidenceListItem({ item, t }: { item: EvidenceItem; t: (key: string) => string }) {
  return (
    <li className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5 text-[11px] text-slate-400">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {item.correlationScore !== null && (
          <span className="text-mirqab-accent">{item.correlationScore}% match</span>
        )}
        <Badge status={PROVENANCE_BADGE[item.ingestSource] ?? 'unknown'}>
          {provenanceText(item.ingestSource, item.datasetOrigin)}
        </Badge>
      </div>
      <p className="whitespace-pre-wrap break-words text-slate-300">
        <ExpandableText text={item.sourceExcerpt} t={t} />
      </p>
      {item.rawEvent && item.rawEvent !== item.sourceExcerpt && (
        <p
          className="mt-1 truncate font-mono text-[10px] text-slate-500"
          title={item.rawEvent}
        >
          Raw: {item.rawEvent}
        </p>
      )}
    </li>
  );
}

/**
 * Shared Read more/Show less implementation — the single reusable place
 * every long, real (never truncated in storage/the API) piece of incident
 * text in this panel collapses to a short preview through. Originally
 * EvidenceListItem's own inline logic; every other long-text field in this
 * panel (description, "how it started", timeline entries, IOC/persistence
 * descriptions, AI summaries, recommendation reasons, historical action
 * notes) now reuses this instead of re-implementing the same toggle.
 * Renders inline (no wrapping block element) so callers keep control of
 * their own paragraph/label markup — the toggle button sits right after
 * the text, same as a normal inline "Read more" link.
 */
function ExpandableText({
  text,
  t,
  maxLength = EVIDENCE_PREVIEW_LENGTH,
  prefix = '',
}: {
  text: string;
  t: (key: string) => string;
  maxLength?: number;
  prefix?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxLength;
  const displayText = expanded || !isLong ? text : `${text.slice(0, maxLength).trimEnd()}…`;

  return (
    <>
      {prefix}
      {displayText}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="ms-1 rounded text-[10px] font-medium text-mirqab-accent outline-none hover:underline focus-visible:ring-1 focus-visible:ring-mirqab-accent"
        >
          {expanded ? t('investigation.showLess') : t('investigation.readMore')}
        </button>
      )}
    </>
  );
}

/** Ticks once a second, only while `running`. */
function useTick(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  return now;
}

const CONTAINMENT_STATUS_KEY: Record<IncidentAction['outcome'], string> = {
  pending: 'investigation.responseWindow.statusPending',
  success: 'investigation.responseWindow.statusSucceeded',
  failed: 'investigation.responseWindow.statusFailed',
};

/**
 * The 5-minute response window card. Renders ONLY the backend's
 * `ResponseWindow` (see backend ResponseSlaService) — it never computes a
 * deadline and never decides containment. The live MM:SS is the backend's
 * own `remainingMs` advanced by elapsed client time (lib/sla.ts); when it
 * reaches 00:00 the card shows "expired" visually and asks the backend for
 * its authoritative state (`onDeadlineReached`), never acting on its own.
 */
function ResponseWindowCard({
  response,
  status,
  onAcknowledge,
  acknowledging,
  acknowledgeFailed,
  onReview,
  onDeadlineReached,
  t,
}: {
  response: ResponseWindow;
  status: IncidentStatus;
  onAcknowledge: () => void;
  acknowledging: boolean;
  acknowledgeFailed: boolean;
  onReview: () => void;
  onDeadlineReached: () => void;
  t: (key: string) => string;
}) {
  const running = isResponseCountdownRunning(response);
  const now = useTick(running);
  const remaining = remainingResponseMs(response, now);
  const locallyExpired = running && remaining !== null && remaining <= 0;

  const reportedDeadline = useRef(false);
  useEffect(() => {
    reportedDeadline.current = false;
  }, [response.deadline, response.state]);
  useEffect(() => {
    if (locallyExpired && !reportedDeadline.current) {
      reportedDeadline.current = true;
      onDeadlineReached();
    }
  }, [locallyExpired, onDeadlineReached]);

  const canAcknowledge = !response.acknowledgedAt;
  const actions = (
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      <Button variant="secondary" size="sm" onClick={onReview}>
        {t('investigation.responseWindow.reviewIncident')}
      </Button>
      {canAcknowledge && (
        <Button size="sm" onClick={onAcknowledge} disabled={acknowledging}>
          {acknowledging
            ? t('investigation.responseWindow.acknowledging')
            : t('investigation.responseWindow.acknowledge')}
        </Button>
      )}
    </div>
  );
  const failure = acknowledgeFailed && (
    <p className="mt-2 text-[11px] text-mirqab-danger" role="alert">
      {t('investigation.responseWindow.acknowledgeFailed')}
    </p>
  );
  const respondedLine = response.respondedInMs !== null && (
    <p className="text-xs text-slate-300">
      {t('investigation.responseWindow.respondedIn')}{' '}
      <LtrText className="font-mono font-semibold">{formatSlaDuration(response.respondedInMs)}</LtrText>
      {response.respondedWithinWindow === false && (
        <span className="text-slate-500"> ({t('investigation.responseWindow.respondedLate')})</span>
      )}
    </p>
  );
  const acknowledgedDetails = response.acknowledgedAt && (
    <dl className="mt-2 space-y-1 text-[11px] text-slate-400">
      <div className="flex justify-between gap-2">
        <dt>{t('investigation.responseWindow.acknowledgedAt')}</dt>
        <dd>
          <LtrText>{formatDateTime(response.acknowledgedAt)}</LtrText>
        </dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt>{t('investigation.responseWindow.acknowledgedBy')}</dt>
        <dd>
          <LtrText>{response.acknowledgedBy ?? '—'}</LtrText>
        </dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt>{t('investigation.responseWindow.currentStatus')}</dt>
        <dd>
          <LtrText>{status}</LtrText>
        </dd>
      </div>
    </dl>
  );

  if (!response.applicable) {
    return (
      <div
        data-testid="response-window"
        data-state={response.state}
        className="rounded-xl2 border border-white/5 bg-white/5 p-2.5 text-xs text-slate-400"
      >
        <p className="flex items-center gap-2">
          <Timer className="h-4 w-4 shrink-0" />
          {t('investigation.responseWindow.notApplicable')}
        </p>
        {respondedLine}
      </div>
    );
  }

  if (response.state === 'waiting-response' && !locallyExpired) {
    const policy = response.automatedContainment;
    const noticeKey = !policy.providerAvailable
      ? 'investigation.responseWindow.autoContainmentUnavailable'
      : !policy.policyEnabled
        ? 'investigation.responseWindow.autoContainmentDisabled'
        : policy.blockedReason === 'simulated'
          ? 'investigation.responseWindow.simulatedNotice'
          : 'investigation.responseWindow.autoContainmentArmed';
    return (
      <div
        data-testid="response-window"
        data-state="waiting-response"
        className="rounded-xl2 border border-mirqab-warning/40 bg-mirqab-warning/10 p-3 text-center"
      >
        <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-mirqab-warning">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t('investigation.responseWindow.required')}
        </p>
        <p className="mt-1 text-slate-200">
          <LtrText className="font-mono text-3xl font-bold tabular-nums text-mirqab-warning">
            {formatResponseCountdown(remaining ?? 0, response.windowMs)}
          </LtrText>{' '}
          <span className="text-xs text-slate-400">{t('investigation.responseWindow.remaining')}</span>
        </p>
        <p className="mt-1 text-xs text-slate-300">{t('investigation.responseWindow.pleaseReview')}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t(noticeKey)}</p>
        {actions}
        {failure}
      </div>
    );
  }

  if (response.state === 'waiting-response' || response.state === 'window-expired') {
    const reason = response.automatedContainment.blockedReason;
    const detailKey =
      reason === 'provider-unavailable'
        ? 'investigation.responseWindow.autoContainmentUnavailable'
        : reason === 'policy-disabled'
          ? 'investigation.responseWindow.autoContainmentDisabled'
          : reason === 'simulated'
            ? 'investigation.responseWindow.simulatedNotice'
            : 'investigation.responseWindow.expiredPendingDecision';
    return (
      <div
        data-testid="response-window"
        data-state="window-expired"
        className="rounded-xl2 border border-mirqab-danger/40 bg-mirqab-danger/10 p-3 text-center"
      >
        <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-mirqab-danger">
          <Timer className="h-3.5 w-3.5" />
          {t('investigation.responseWindow.expired')}
        </p>
        <p className="mt-1">
          <LtrText className="font-mono text-3xl font-bold tabular-nums text-mirqab-danger">
            {formatResponseCountdown(0, response.windowMs)}
          </LtrText>
        </p>
        <p className="mt-1 text-[11px] text-slate-400">{t(detailKey)}</p>
        {actions}
        {failure}
      </div>
    );
  }

  if (response.state === 'acknowledged') {
    return (
      <div
        data-testid="response-window"
        data-state="acknowledged"
        className="rounded-xl2 border border-mirqab-success/30 bg-mirqab-success/5 p-3"
      >
        <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-mirqab-success">
          <Check className="h-3.5 w-3.5" />
          {t('investigation.responseWindow.received')}
        </p>
        <div className="mt-1 text-center">{respondedLine}</div>
        <p className="mt-1 text-center text-[11px] text-slate-400">
          {t('investigation.responseWindow.noAutoContainment')}
        </p>
        {acknowledgedDetails}
      </div>
    );
  }

  // containment-pending / -succeeded / -failed
  const containment = response.containment;
  const outcome = containment?.outcome ?? 'pending';
  const tone =
    outcome === 'success' ? 'success' : outcome === 'failed' ? 'danger' : 'warning';
  return (
    <div
      data-testid="response-window"
      data-state={response.state}
      className={clsx(
        'rounded-xl2 border p-3',
        tone === 'success' && 'border-mirqab-success/30 bg-mirqab-success/5',
        tone === 'danger' && 'border-mirqab-danger/40 bg-mirqab-danger/10',
        tone === 'warning' && 'border-mirqab-warning/40 bg-mirqab-warning/10',
      )}
    >
      <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
        <ShieldOff className="h-3.5 w-3.5" />
        {containment?.automated
          ? t('investigation.responseWindow.containmentTriggered')
          : t('investigation.responseWindow.isolationRecorded')}
      </p>
      {containment?.automated && (
        <p className="mt-1 text-center text-xs text-slate-300">
          {t('investigation.responseWindow.containmentReason')}
        </p>
      )}
      <dl className="mt-2 space-y-1 text-[11px] text-slate-400">
        <div className="flex justify-between gap-2">
          <dt>{t('investigation.responseWindow.isolationStatus')}</dt>
          <dd
            data-testid="containment-status"
            className={clsx(
              'font-semibold',
              tone === 'success' && 'text-mirqab-success',
              tone === 'danger' && 'text-mirqab-danger',
              tone === 'warning' && 'text-mirqab-warning',
            )}
          >
            {t(CONTAINMENT_STATUS_KEY[outcome])}
          </dd>
        </div>
        {containment && (
          <div className="flex justify-between gap-2">
            <dt>{t('investigation.responseWindow.requestedAt')}</dt>
            <dd>
              <LtrText>{formatDateTime(containment.requestedAt)}</LtrText>
            </dd>
          </div>
        )}
        {containment?.detail && outcome !== 'pending' && (
          <div>
            <dt>{t('investigation.responseWindow.providerResult')}</dt>
            <dd className="mt-0.5 text-slate-300">
              <LtrText>{containment.detail}</LtrText>
            </dd>
          </div>
        )}
      </dl>
      {response.acknowledgedAt && (
        <div className="mt-2 border-t border-white/5 pt-2 text-center">
          {respondedLine}
          <p className="text-[11px] text-slate-400">
            {outcome === 'success'
              ? t('investigation.responseWindow.alreadyIsolated')
              : t('investigation.responseWindow.lateResponseRecorded')}
          </p>
        </div>
      )}
      {!response.acknowledgedAt && actions}
      {failure}
    </div>
  );
}

/**
 * Suggested Solutions panel — the headline summary of the single best
 * historical match (see AiService.getInvestigation's `topMatch`), distinct
 * from the full "Similar Incidents" list below it.
 *
 * Purely informational/historical — it has no Apply/Execute/Approve action
 * of its own. The one "Apply Recommended Response" button in this panel
 * lives entirely in the RECOMMENDATIONS section further down, so the same
 * recommended action is never shown as two separate actionable entry
 * points. `topMatch.successfulActions` here is what was recorded/succeeded
 * in *past* incidents; the RECOMMENDATIONS section's `sufficientData`/
 * `riskLevel`/`humanApprovalRequired` fields describe what can actually be
 * applied to *this* incident, computed from the same underlying data.
 *
 * Real data only, with two distinct honest empty states rather than one
 * generic one:
 *  - `topMatch` null → no comparable incidents exist at all (noHistory).
 *  - `topMatch` present but has no successful actions of its own →
 *    noActionsRecorded (existing, unchanged).
 */
function SuggestedSolutionsCard({
  investigation,
  actionLabel,
  t,
}: {
  investigation: IncidentInvestigation;
  actionLabel: (type: IncidentActionType) => string;
  t: (key: string) => string;
}) {
  const { topMatch } = investigation;

  return (
    <section className="space-y-3 rounded-xl2 border border-mirqab-accent/20 bg-mirqab-accent/5 p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
        <Sparkles className="h-3.5 w-3.5 text-mirqab-accent" />
        {t('investigation.suggestedSolutions.title')}
      </h3>

      {!topMatch ? (
        <p className="text-xs text-slate-500">{t('investigation.suggestedSolutions.noHistory')}</p>
      ) : (
        <>
          <dl className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">{t('investigation.suggestedSolutions.similarityLabel')}</dt>
              <dd className="font-mono font-semibold text-mirqab-accent">
                {topMatch.similarityPercent}%
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">{t('investigation.suggestedSolutions.lastOccurrence')}</dt>
              <dd className="text-end text-slate-200">
                {formatDateTime(topMatch.occurredAt)} ({topMatch.daysAgo}{' '}
                {t('investigation.suggestedSolutions.daysAgoUnit')})
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">{t('investigation.suggestedSolutions.previousCase')}</dt>
              <dd className="font-mono text-slate-200">{topMatch.caseId}</dd>
            </div>
          </dl>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t('investigation.suggestedSolutions.effectiveSolutions')}
            </p>
            {topMatch.successfulActions.length === 0 ? (
              <p className="text-[11px] text-slate-500">{t('investigation.noActionsRecorded')}</p>
            ) : (
              <ul className="space-y-1">
                {topMatch.successfulActions.map((action) => (
                  <li key={action.id} className="flex items-center gap-2 text-sm text-slate-100">
                    <Check className="h-3.5 w-3.5 shrink-0 text-mirqab-success" />
                    {actionLabel(action.type)}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[11px] text-slate-500">
              {t('investigation.suggestedSolutions.historicalNote')}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function RiskTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl2 border border-white/5 bg-white/5 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold" style={color ? { color } : undefined}>
        {value || INSUFFICIENT_DATA}
      </p>
    </div>
  );
}

function DimensionChip({ dimension }: { dimension: ComparisonDimension }) {
  return (
    <span
      title={dimension.detail}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
        !dimension.hasData
          ? 'border-slate-600 text-slate-500'
          : dimension.matchStrength > 0
            ? 'border-mirqab-success/40 bg-mirqab-success/10 text-mirqab-success'
            : 'border-slate-600 text-slate-500',
      )}
    >
      {dimension.hasData && dimension.matchStrength > 0 ? (
        <Check className="h-2.5 w-2.5" />
      ) : (
        <X className="h-2.5 w-2.5" />
      )}
      {dimension.label}
    </span>
  );
}

function ActionRow({
  action,
  actionLabel,
  outcomeLabel,
  t,
  onMark,
  onApprove,
  onReject,
  approvePending,
  rejectPending,
}: {
  action: IncidentAction;
  actionLabel: (type: IncidentActionType) => string;
  outcomeLabel: (outcome: IncidentAction['outcome']) => string;
  t: (key: string) => string;
  onMark?: (outcome: 'success' | 'failed') => void;
  onApprove?: () => void;
  onReject?: () => void;
  approvePending?: boolean;
  rejectPending?: boolean;
}) {
  // Requirement #6: a high-impact AI-recommended action can't be marked
  // success/failed until an analyst has explicitly approved it — a rejected
  // one can never be executed at all.
  const pendingApproval = action.approvalStatus === 'pending-approval';
  const rejected = action.approvalStatus === 'rejected';
  const canMarkOutcome = !pendingApproval && !rejected;

  return (
    <li className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-white/5 px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-200">{actionLabel(action.type)}</p>
        {action.notes && (
          <p className="text-[10px] text-slate-500">
            <ExpandableText text={action.notes} t={t} />
          </p>
        )}
        {action.requestedBy === 'ai:recommendation-agent' && (
          <p className="truncate text-[10px] text-mirqab-accent">AI-recommended</p>
        )}
        {action.performedBy === 'system:auto-response-policy' && (
          <p className="truncate text-[10px] text-mirqab-warning">
            Automated containment policy — SLA breach
          </p>
        )}
        {rejected && action.rejectedReason && (
          <p className="truncate text-[10px] text-mirqab-danger">
            Rejected: {action.rejectedReason}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {pendingApproval && <Badge status="unknown">Pending approval</Badge>}
        {rejected && <Badge status="danger">Rejected</Badge>}
        <Badge
          status={
            action.outcome === 'success'
              ? 'success'
              : action.outcome === 'failed'
                ? 'danger'
                : 'unknown'
          }
        >
          {outcomeLabel(action.outcome)}
        </Badge>
        {pendingApproval && onApprove && onReject && (
          <>
            <button
              onClick={onApprove}
              disabled={approvePending}
              className="rounded p-1 text-mirqab-success hover:bg-mirqab-success/10 disabled:opacity-50"
              title="Approve"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={onReject}
              disabled={rejectPending}
              className="rounded p-1 text-mirqab-danger hover:bg-mirqab-danger/10 disabled:opacity-50"
              title="Reject"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
        {onMark && canMarkOutcome && action.outcome === 'pending' && (
          <>
            <button
              onClick={() => onMark('success')}
              className="rounded p-1 text-mirqab-success hover:bg-mirqab-success/10"
              title="Mark success"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={() => onMark('failed')}
              className="rounded p-1 text-mirqab-danger hover:bg-mirqab-danger/10"
              title="Mark failed"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function SimilarIncidentCard({
  entry,
  expanded,
  onToggle,
  departmentName,
  deviceHostname,
  actionLabel,
  outcomeLabel,
  t,
}: {
  entry: SimilarIncidentEntry;
  expanded: boolean;
  onToggle: () => void;
  departmentName: (id: string | null) => string;
  deviceHostname: (id: string | null) => string;
  actionLabel: (type: IncidentActionType) => string;
  outcomeLabel: (outcome: IncidentAction['outcome']) => string;
  t: (key: string) => string;
}) {
  return (
    <li className="rounded-xl2 border border-white/5 bg-white/5">
      <button
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-2 p-3 text-start"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{entry.incident.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {deviceHostname(entry.incident.deviceId)} ·{' '}
            {departmentName(entry.incident.departmentId)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-bold text-mirqab-accent">{entry.score}%</span>
          <span className="text-[10px] text-slate-500">
            {t('investigation.confidence')} {entry.confidence}%
          </span>
        </div>
        <ChevronDown
          className={clsx(
            'mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-white/5 p-3">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t('investigation.whySimilar')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {entry.dimensions.map((dimension) => (
                <DimensionChip key={dimension.key} dimension={dimension} />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t('investigation.timeline')}
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatDateTime(entry.timeline.occurredAt)}
              </span>
              <span>{formatRelativeTime(entry.timeline.occurredAt)}</span>
              <span>
                {t('investigation.duration')}:{' '}
                {entry.timeline.durationMs !== null
                  ? formatDuration(entry.timeline.durationMs)
                  : t('investigation.noData')}
              </span>
              <span>
                {t('investigation.resolutionTime')}:{' '}
                {entry.timeline.resolutionTimeMs !== null
                  ? formatDuration(entry.timeline.resolutionTimeMs)
                  : t('investigation.noData')}
              </span>
              <span className="col-span-2">
                {t('investigation.handledBy')}:{' '}
                {entry.timeline.handledBy ?? t('investigation.unassigned')}
              </span>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t('investigation.previousResponse')}
            </p>
            {entry.actions.length === 0 ? (
              <p className="text-[11px] text-slate-500">{t('investigation.noActionsRecorded')}</p>
            ) : (
              <ul className="space-y-1">
                {entry.actions.map((action) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    actionLabel={actionLabel}
                    outcomeLabel={outcomeLabel}
                    t={t}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-white/5 pt-2">
            <SeverityBadge severity={entry.incident.severity} />
            <Badge status="unknown">{entry.incident.status}</Badge>
          </div>
        </div>
      )}
    </li>
  );
}
