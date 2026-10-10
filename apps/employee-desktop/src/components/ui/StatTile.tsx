import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { Card } from './Card';

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
}

const TONE_CLASSES: Record<NonNullable<StatTileProps['tone']>, string> = {
  success: 'text-mirqab-success',
  warning: 'text-mirqab-warning',
  danger: 'text-mirqab-danger',
  neutral: 'text-mirqab-accent',
};

export function StatTile({ icon: Icon, label, value, hint, tone = 'neutral' }: StatTileProps) {
  return (
    <Card className="flex items-start gap-4">
      <div
        className={clsx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5',
          TONE_CLASSES[tone],
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </div>
    </Card>
  );
}
