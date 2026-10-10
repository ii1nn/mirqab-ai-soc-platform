import { useQuery } from '@tanstack/react-query';
import { auditLogsService } from '../services/audit-logs.service';

export function useAuditLogs() {
  return useQuery({
    queryKey: ['audit-logs'],
    queryFn: auditLogsService.list,
    // Safety net — useRealtimeSync invalidates this on audit-log.created.
    refetchInterval: 30_000,
  });
}
