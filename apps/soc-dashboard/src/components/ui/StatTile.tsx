import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { Card } from './Card';

export type StatTone = 'red' | 'orange' | 'blue' | 'pink' | 'purple';

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: StatTone;
}

const TONE: Record<
  StatTone,
  { text: string; iconBg: string; glow: 'red' | 'orange' | 'blue' | 'pink' | 'purple' }
> = {
  red: { text: 'text-mirqab-danger', iconBg: 'bg-mirqab-danger/15', glow: 'red' },
  orange: { text: 'text-mirqab-warning', iconBg: 'bg-mirqab-warning/15', glow: 'orange' },
  blue: { text: 'text-mirqab-blue', iconBg: 'bg-mirqab-blue/15', glow: 'blue' },
  pink: { text: 'text-mirqab-accentPink', iconBg: 'bg-mirqab-accentPink/15', glow: 'pink' },
  purple: { text: 'text-mirqab-accent', iconBg: 'bg-mirqab-accent/15', glow: 'purple' },
};

export function StatTile({ icon: Icon, label, value, tone = 'purple' }: StatTileProps) {
  const tones = TONE[tone];

  return (
    <Card
      glow={tones.glow}
      className={clsx(
        'relative overflow-hidden',
        // Card's `purple`/`pink` glow variants are hover-only, unlike
        // `red`/`orange`/`blue`/`green`, which are always visible — applying
        // the same shadow class here (redundant with, and additive to,
        // Card's own hover: variant) keeps every KPI tile's glow equally
        // visible without changing that shared, hover-only behavior for
        // other cards elsewhere in the app that intentionally rely on it.
        tone === 'purple' && 'shadow-glow',
        tone === 'pink' && 'shadow-glow-pink',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold text-white">{value}</p>
        </div>
        <div
          className={clsx(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
            tones.iconBg,
            tones.text,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div
        className={clsx(
          'pointer-events-none absolute -end-6 -top-6 h-24 w-24 rounded-full blur-2xl',
          tones.iconBg,
        )}
      />
    </Card>
  );
}
