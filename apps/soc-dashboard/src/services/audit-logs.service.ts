import type { AuditLogEntry } from '../types/domain';
import { apiClient } from './api-client';
import type { BackendAuditLog } from './backend-types';

function adapt(entry: BackendAuditLog): AuditLogEntry {
  return {
    id: entry.id,
    actorEmail: entry.actorEmail,
    action: entry.action,
    target: entry.target ?? undefined,
    timestamp: entry.createdAt,
  };
}

export const auditLogsService = {
  async list(): Promise<AuditLogEntry[]> {
    const { data } = await apiClient.get<BackendAuditLog[]>('/audit-logs');
    return data.map(adapt);
  },
};
