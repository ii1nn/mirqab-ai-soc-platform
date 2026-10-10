import clsx from 'clsx';

type Tone = 'healthy' | 'critical' | 'high' | 'info' | 'idle';

const TONE_STYLES: Record<Tone, string> = {
  healthy: 'bg-mirqab-success shadow-glow-green',
  critical: 'bg-mirqab-danger shadow-glow-red',
  high: 'bg-mirqab-warning shadow-glow-orange',
  info: 'bg-mirqab-blue shadow-glow-blue',
  idle: 'bg-slate-600',
};

/** Small pulsing status dot — generalized from Topbar's original inline
 * simulation-indicator markup so any live/offline/severity indicator uses
 * the same visual language. */
export function StatusDot({ tone, pulse = true }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      className={clsx('h-2 w-2 rounded-full', TONE_STYLES[tone], pulse && 'animate-pulse-glow')}
    />
  );
}
