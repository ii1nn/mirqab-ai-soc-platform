import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { SecurityStatus } from '../../types/domain';

const STYLES: Record<SecurityStatus, string> = {
  success: 'bg-mirqab-success/15 text-mirqab-success border-mirqab-success/30',
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
