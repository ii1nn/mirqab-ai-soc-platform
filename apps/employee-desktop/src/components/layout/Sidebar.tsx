import clsx from 'clsx';
import { Activity, Bell, History, Laptop, LayoutDashboard, LogOut, ScanSearch, Wrench } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useNotificationsStore } from '../../store/notifications.store';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/device-health', label: 'Device Health', icon: Activity },
  { to: '/device-info', label: 'Device Info', icon: Laptop },
  { to: '/scan', label: 'AI Scan', icon: ScanSearch },
  { to: '/incidents', label: 'Incidents', icon: History },
  { to: '/fixes', label: 'Recommended Fixes', icon: Wrench },
  { to: '/notifications', label: 'Notifications', icon: Bell, showUnread: true },
] as const;

export function Sidebar() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const unreadCount = useNotificationsStore((state) => state.unreadCount);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-mirqab-border bg-mirqab-secondary/60 px-3 py-4">
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : false}
            className={({ isActive }) =>
              clsx(
                'relative flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-mirqab-accent/12 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute inset-y-1 start-0 w-0.5 rounded-full bg-mirqab-accent shadow-glow-sm" />
                )}
                <span className="flex items-center gap-3">
                  <item.icon
                    className={clsx('h-4 w-4', isActive ? 'text-mirqab-accent' : undefined)}
                  />
                  {item.label}
                </span>
                {'showUnread' in item && item.showUnread && unreadCount > 0 && (
                  <span className="rounded-full bg-mirqab-danger px-1.5 text-xs font-semibold text-white">
                    {unreadCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-4 border-t border-mirqab-border pt-4">
        <p className="truncate text-sm font-medium text-slate-200">
          {user ? `${user.firstName} ${user.lastName}` : 'Unknown user'}
        </p>
        <p className="truncate text-xs text-slate-500">{user?.email}</p>
        <button
          onClick={() => logout()}
          className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-mirqab-danger"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
