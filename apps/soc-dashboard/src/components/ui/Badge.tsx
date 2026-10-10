import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { SecurityStatus } from '../../types/domain';

const STYLES: Record<SecurityStatus, string> = {
  success: 'bg-mirqab-success/15 text-mirqab-success border-mirqab-success/30',
  info: 'bg-mirqab-yellow/15 text-mirqab-yellow border-mirqab-yellow/30',
  warning: 'bg-mirqab-warning/15 text-mirqab-warning border-mirqab-warning/30',
  danger: 'bg-mirqab-danger/15 text-mirqab-danger border-mirqab-danger/30',
  unknown: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export function Badge({ status, children }: { status: SecurityStatus; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize',
        STYLES[status],
      )}
    >
      {children}
    </span>
  );
}

/** low -> green, medium -> yellow, high -> orange, critical -> red. */
const SEVERITY_TO_STATUS: Record<string, SecurityStatus> = {
  low: 'success',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};

export const SEVERITY_COLOR: Record<string, string> = {
  low: '#10B981',
  medium: '#FBBF24',
  high: '#F59E0B',
  critical: '#FF3B5C',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge status={SEVERITY_TO_STATUS[severity] ?? 'unknown'}>{severity}</Badge>;
}
