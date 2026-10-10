import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from './Card';

/** Consistent "nothing here yet" state — mirrors apps/soc-dashboard's primitive. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
}: {
  icon?: typeof Inbox;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-slate-500">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-medium text-slate-300">{title}</p>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-12 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 border-mirqab-danger/25 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-mirqab-danger/10 text-mirqab-danger">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-medium text-slate-200">{title}</p>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </Card>
  );
}
