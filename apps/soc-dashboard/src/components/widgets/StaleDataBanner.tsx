import { WifiOff } from 'lucide-react';

/**
 * Phase 15 (production failure-mode testing): `useDevices`/`useIncidents`/
 * `useDepartments` are all consumed as `{ data: x = [] }` on the Live Map /
 * Citadel wallboard pages — react-query's default-to-empty-array pattern,
 * used everywhere else in this app because an empty list and "still
 * loading" both render the same harmless empty state. On a SOC wallboard
 * specifically, that same defaulting silently turns "the backend is
 * unreachable" into "0 active threats, all devices online" — a genuinely
 * false-reassuring state for the one screen whose entire purpose is
 * telling an analyst whether something is wrong right now. This banner is
 * the minimal fix: surface that the *displayed* data may not reflect
 * live state, without touching the underlying query/caching behavior or
 * inventing a broader loading-state redesign for the rest of the app.
 */
export function StaleDataBanner({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div className="flex items-center gap-2 rounded-xl2 border border-mirqab-danger/40 bg-mirqab-danger/10 px-3 py-2 text-xs font-medium text-mirqab-danger">
      <WifiOff className="h-4 w-4 shrink-0" />
      Connection to the backend was lost — the data shown below is not confirmed live and may be
      stale or incomplete.
    </div>
  );
}
