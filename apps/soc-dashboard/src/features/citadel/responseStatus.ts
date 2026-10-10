import { remainingResponseMs } from '../../lib/sla';
import type { IncidentHistoryRecord } from '../../types/domain';

export type ResponseStatus = 'Detected' | 'Investigating' | 'Isolating' | 'Contained' | 'Resolved';

/**
 * Derived entirely from the real Incident.status enum (open/investigating/
 * contained/resolved/closed) plus a real pending ISOLATE_DEVICE action —
 * both already returned by GET /ai/incidents/:id/history. No status here is
 * invented: "Isolating" only appears when a real IncidentAction row with
 * outcome PENDING actually exists (see AiService.createIncidentAction).
 */
export function deriveResponseStatus(incident: IncidentHistoryRecord): ResponseStatus {
  if (incident.status === 'resolved' || incident.status === 'closed') return 'Resolved';
  if (incident.status === 'contained') return 'Contained';

  const hasPendingIsolation = incident.actionsTaken.some(
    (action) => action.actionType === 'ISOLATE_DEVICE' && action.status === 'pending',
  );
  if (hasPendingIsolation) return 'Isolating';

  if (incident.status === 'investigating') return 'Investigating';
  return 'Detected';
}

export interface EstimatedArrival {
  label: string;
  /** True only for a real, computed countdown — lets the UI style it
   * distinctly from the "Calculating…"/"Not available" placeholder text. */
  isLive: boolean;
}

/**
 * "Arrival" here means the backend's own 5-minute response-window deadline
 * for this case (incident.response — see backend ResponseSlaService), never
 * a number computed in the browser. Only shown while the backend says a
 * response is still awaited (WAITING_RESPONSE) or the window just expired
 * unanswered; anything else — low/medium severity, an acknowledged case, or
 * one already contained — honestly reports "Not available".
 */
export function estimateArrival(
  incident: IncidentHistoryRecord | undefined,
  isLoading: boolean,
): EstimatedArrival {
  if (isLoading || !incident) return { label: 'Calculating…', isLive: false };
  if (incident.response.state === 'window-expired') return { label: 'Overdue', isLive: true };
  if (incident.response.state !== 'waiting-response') return { label: 'Not available', isLive: false };

  const remainingMs = remainingResponseMs(incident.response);
  if (remainingMs === null) return { label: 'Not available', isLive: false };
  if (remainingMs <= 0) return { label: 'Overdue', isLive: true };

  const minutes = Math.round(remainingMs / 60_000);
  if (minutes < 1) return { label: '<1 min', isLive: true };
  if (minutes < 60) return { label: `~${minutes} min`, isLive: true };
  const hours = Math.round(minutes / 60);
  return { label: `~${hours}h`, isLive: true };
}
