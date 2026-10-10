export function formatRelativeTime(iso: string): string {
  const diffMinutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** MM:SS countdown display — shared by ThreatTopology's lateral-movement
 * timer (always well under an hour, so MM:SS reads fine there) and, prior
 * to the day/hour-aware fix below, the Incident Response panel's SLA
 * timer — which is why an incident days overdue used to render as a raw
 * "23114:55" instead of something readable. Left as-is here since
 * ThreatTopology still wants plain MM:SS; see formatSlaDuration for the
 * incident response panel's own formatter. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Strict MM:SS for the 5-minute response window ("04:59", "00:45").
 * Clamped to [0, maxMs] so a stale or skewed input can never render an
 * enormous raw minute value like "14996:32". */
export function formatResponseCountdown(ms: number, maxMs: number): string {
  const clamped = Math.min(Math.max(ms, 0), maxMs);
  const totalSeconds = Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/** Human-readable duration for the Incident Response panel's SLA timer —
 * "15d 2h 14m" / "2h 14m" / "14m 32s", never a raw multi-thousand-minute
 * MM:SS pair. Seconds are only shown once a duration is under an hour, per
 * the same reasoning ThreatTopology's short countdown doesn't need days. */
export function formatSlaDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}
