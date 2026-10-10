import clsx from 'clsx';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { formatRelativeTime } from '../../lib/format';
import { useNotificationsStore } from '../../store/notifications.store';

export function NotificationsPage() {
  const items = useNotificationsStore((state) => state.items);
  const markAllRead = useNotificationsStore((state) => state.markAllRead);
  const markRead = useNotificationsStore((state) => state.markRead);

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Notifications</h2>
        <Button variant="ghost" onClick={markAllRead}>
          Mark all read
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">
          You&apos;re all caught up. This device hasn&apos;t triggered any alerts.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((notification) => (
            <li
              key={notification.id}
              onClick={() => markRead(notification.id)}
              className={clsx(
                'cursor-pointer rounded-xl border border-white/5 p-3 transition',
                notification.read ? 'bg-transparent opacity-60' : 'bg-white/5',
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-200">{notification.title}</p>
                <span className="text-xs text-slate-500">
                  {formatRelativeTime(notification.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{notification.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
