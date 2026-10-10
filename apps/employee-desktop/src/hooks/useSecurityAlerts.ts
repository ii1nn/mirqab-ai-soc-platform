import { useEffect, useRef } from 'react';
import { useNotificationsStore } from '../store/notifications.store';
import type { SecurityScoreResult } from '../types/domain';

/** Pushes a notification the moment a check transitions into "danger" — not on every poll. */
export function useSecurityAlerts(result: SecurityScoreResult | null): void {
  const push = useNotificationsStore((state) => state.push);
  const previousStatuses = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!result) return;

    for (const check of result.checks) {
      const previous = previousStatuses.current[check.id];
      if (previous !== 'danger' && check.status === 'danger') {
        push({ title: `${check.label} at risk`, body: check.detail, severity: 'danger' });
      }
      previousStatuses.current[check.id] = check.status;
    }
  }, [result, push]);
}
