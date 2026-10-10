import type { SocNotification } from '../types/domain';
import { fromBackendNotification } from './adapters';
import { apiClient } from './api-client';
import type { BackendNotificationList } from './backend-types';

export const notificationsService = {
  /** Scoped server-side to the caller's organization (and department for
   * IT_TECHNICIAN) — see backend NotificationsService.listForUser. */
  async list(): Promise<{ serverNow: string; items: SocNotification[] }> {
    const { data } = await apiClient.get<BackendNotificationList>('/notifications');
    return {
      serverNow: data.serverNow,
      items: data.items.map((item) => fromBackendNotification(item, data.serverNow)),
    };
  },
};
