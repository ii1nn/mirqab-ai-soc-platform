import clsx from 'clsx';
import {
  Activity,
  BarChart3,
  Bell,
  Brain,
  Building2,
  FileText,
  Laptop,
  LayoutDashboard,
  Radar,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Ticket,
  Users,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageContext';
import type { UserRole } from '../../services/auth.service';
import { useAuthStore } from '../../store/auth.store';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  adminOnly?: boolean;
  /** UX-only allowlist, same caveat as adminOnly — see RequireRole's own
   * comment in App.tsx. Only needed for pages that aren't already ADMIN-only. */
  roles?: UserRole[];
}

interface NavGroup {
  groupKey: string | null;
  items: NavItem[];
}

/** Exported so Topbar can derive the current page title/breadcrumb from the
 * same single list of real routes instead of maintaining a second copy. */
export const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: null,
    items: [
      { to: '/', labelKey: 'nav.overview', icon: LayoutDashboard, end: true },
      { to: '/alerts', labelKey: 'nav.incidents', icon: ShieldAlert },
      { to: '/threat-map', labelKey: 'nav.liveNetworkMap', icon: Radar },
      { to: '/departments', labelKey: 'nav.departments', icon: Building2 },
      { to: '/notifications', labelKey: 'nav.notifications', icon: Bell },
      { to: '/tickets', labelKey: 'nav.tickets', icon: Ticket },
      { to: '/incident-memory', labelKey: 'nav.incidentMemory', icon: Brain },
      { to: '/reports', labelKey: 'nav.reports', icon: FileText },
      { to: '/policies', labelKey: 'nav.policies', icon: ScrollText },
      { to: '/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
  {
    groupKey: 'more',
    items: [
      { to: '/citadel', labelKey: 'nav.citadel', icon: ShieldCheck },
      { to: '/devices', labelKey: 'nav.devices', icon: Laptop },
      { to: '/analytics', labelKey: 'nav.analytics', icon: BarChart3 },
      { to: '/users', labelKey: 'nav.userManagement', icon: Users, adminOnly: true },
      {
        to: '/audit-logs',
        labelKey: 'nav.auditLogs',
        icon: Activity,
        roles: ['ADMIN', 'SECURITY_ANALYST'],
      },
      {
        to: '/security-testing',
        labelKey: 'nav.securityTesting',
        icon: ShieldQuestion,
        adminOnly: true,
      },
    ],
  },
];

export function Sidebar() {
  const role = useAuthStore((state) => state.user?.role);
  const { t } = useLanguage();

  return (
    <aside className="relative z-10 flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-e border-mirqab-border bg-mirqab-secondary/70 px-3 py-5 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-2">
        {/* text-[#fff]: solid brand-gradient fill in both themes, must stay literally white */}
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-mirqab-brand text-[#fff] shadow-glow-sm">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold tracking-wide text-white">{t('app.name')}</p>
          <p className="truncate text-[10px] uppercase tracking-widest text-mirqab-accent/80">
            {t('app.tagline')}
          </p>
        </div>
      </div>

      {NAV_GROUPS.map((group, groupIndex) => {
        const items = group.items.filter(
          (item) =>
            (!item.adminOnly || role === 'ADMIN') && (!item.roles || (role && item.roles.includes(role))),
        );
        if (items.length === 0) return null;

        return (
          <div key={group.groupKey ?? 'primary'}>
            {group.groupKey && (
              <p className="mb-1 border-t border-mirqab-border px-3 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                {t(`nav.groups.${group.groupKey}`)}
              </p>
            )}
            <nav className="flex flex-col gap-0.5">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
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
                      <item.icon
                        className={clsx(
                          'h-4 w-4 shrink-0',
                          isActive
                            ? 'text-mirqab-accent'
                            : 'text-slate-500 group-hover:text-slate-300',
                        )}
                      />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            {groupIndex === 0 && <div className="mt-4" />}
          </div>
        );
      })}
    </aside>
  );
}
