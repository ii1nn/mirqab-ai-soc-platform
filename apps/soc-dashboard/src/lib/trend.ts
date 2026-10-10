/**
 * Percentage change between the most recent window and the one before it —
 * a real comparison against actual timestamps, never a fabricated number.
 * Returns null when there's no prior-window baseline to compare against.
 */
export function computeWindowDelta(timestamps: string[], windowMs = 15 * 60_000): number | null {
  const now = Date.now();
  let current = 0;
  let previous = 0;
  for (const timestamp of timestamps) {
    const age = now - new Date(timestamp).getTime();
    if (age < windowMs) current += 1;
    else if (age < windowMs * 2) previous += 1;
  }
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
