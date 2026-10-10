import { FlaskConical } from 'lucide-react';

/** Flags any content sourced from a placeholder/sample dataset (see docs/phases/phase-3.md). */
export function MockBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-mirqab-warning/30 bg-mirqab-warning/10 px-2 py-0.5 text-[11px] font-medium text-mirqab-warning">
      <FlaskConical className="h-3 w-3" />
      Sample data
    </span>
  );
}
