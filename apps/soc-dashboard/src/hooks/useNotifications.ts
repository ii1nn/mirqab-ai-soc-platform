import { useQuery } from '@tanstack/react-query';
import { notificationsService } from '../services/notifications.service';

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsService.list,
    // Primary path is the notification.created socket event (see
    // useRealtimeSync); this is only the missed-event safety net.
    refetchInterval: 30_000,
  });
}
