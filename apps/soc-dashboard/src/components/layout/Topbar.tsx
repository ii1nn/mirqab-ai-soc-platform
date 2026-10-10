import { AlertTriangle, Bell, ChevronRight, Globe2, LogOut, Play, Square, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Dropdown, DropdownItem } from '../ui/Dropdown';
import { Tooltip } from '../ui/Tooltip';
import { useDevices } from '../../hooks/useDevices';
import { useIncidents } from '../../hooks/useIncidents';
import { useLanguage } from '../../i18n/LanguageContext';
import { useSimulationStore } from '../../simulation/simulationEngine';
import { useAuthStore } from '../../store/auth.store';
import { NAV_GROUPS } from './Sidebar';

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export function Topbar() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const isRunning = useSimulationStore((state) => state.isRunning);
  const lastError = useSimulationStore((state) => state.lastError);
  const start = useSimulationStore((state) => state.start);
  const stop = useSimulationStore((state) => state.stop);
  const devicesQuery = useDevices();
  const incidentsQuery = useIncidents();
  const { data: devices } = devicesQuery;
  const { data: incidents } = incidentsQuery;
  const { t, language, toggleLanguage } = useLanguage();
  const location = useLocation();

  // Real connection indicator — derived from the same queries already
  // powering the rest of the shell (no extra network call). A query in an
  // error state here means the backend/API is genuinely unreachable, not a
  // simulated status.
  const isOffline = devicesQuery.isError || incidentsQuery.isError;

  const currentNavItem = useMemo(
    () => ALL_NAV_ITEMS.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))),
    [location.pathname],
  );

  const criticalUnacknowledged = useMemo(
    () =>
      (incidents ?? []).filter(
        (incident) =>
          !incident.acknowledged &&
          (incident.severity === 'high' || incident.severity === 'critical'),
      ).length,
    [incidents],
  );

  return (
    <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-mirqab-border bg-mirqab-secondary/50 px-6 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2 text-sm text-slate-400">
        <span className="font-medium text-white">{t('app.name')}</span>
        {currentNavItem && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
            <span className="truncate text-slate-300">{t(currentNavItem.labelKey)}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-4">
        {isOffline && (
          <Tooltip label="Could not reach the backend — showing the last known data">
            <span className="flex items-center gap-1.5 rounded-full border border-mirqab-danger/30 bg-mirqab-danger/10 px-2.5 py-1 text-xs font-medium text-mirqab-danger">
              <WifiOff className="h-3.5 w-3.5" />
              Offline
            </span>
          </Tooltip>
        )}

        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${isRunning ? 'animate-pulse-glow bg-mirqab-success shadow-glow-green' : 'bg-slate-600'}`}
          />
          <span className="hidden text-xs text-slate-400 lg:inline">
            {isRunning ? t('topbar.simulationActive') : t('topbar.simulationStopped')}
          </span>
          <Button
            variant={isRunning ? 'danger' : 'secondary'}
            className="px-2.5 py-1 text-xs"
            disabled={!isRunning && !devices?.length}
            onClick={() => (isRunning ? stop() : start(devices ?? []))}
          >
            {isRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {isRunning ? t('topbar.stop') : t('topbar.start')}
          </Button>
          {isRunning && lastError && (
            <Tooltip label={lastError}>
              <span className="flex items-center gap-1.5 rounded-full border border-mirqab-danger/30 bg-mirqab-danger/10 px-2.5 py-1 text-xs font-medium text-mirqab-danger">
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            </Tooltip>
          )}
        </div>

        <button
          type="button"
          onClick={toggleLanguage}
          className="flex items-center gap-1.5 rounded-full border border-mirqab-border bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10"
        >
          <Globe2 className="h-3.5 w-3.5" />
          {language === 'ar' ? 'EN' : 'AR'}
        </button>

        <Link
          to="/notifications"
          aria-label="Notifications"
          className="relative rounded-xl p-1.5 transition hover:bg-white/5"
        >
          <Bell className="h-5 w-5 text-slate-400" />
          {criticalUnacknowledged > 0 && (
            // text-[#fff]: solid danger-color fill in both themes, must stay literally white
            <span className="absolute -end-0.5 -top-0.5 flex h-4 w-4 animate-pulse-glow items-center justify-center rounded-full bg-mirqab-danger text-[10px] font-semibold text-[#fff] shadow-glow-red">
              {criticalUnacknowledged > 9 ? '9+' : criticalUnacknowledged}
            </span>
          )}
        </Link>

        <Dropdown
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-2 rounded-xl px-2 py-1 text-sm hover:bg-white/5"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-mirqab-accent/15 text-xs font-semibold text-mirqab-accent">
                {user ? `${user.firstName[0]}${user.lastName[0]}` : '?'}
              </span>
              <span className="text-slate-300">
                {user ? `${user.firstName} ${user.lastName}` : ''}
              </span>
            </button>
          )}
        >
          <div className="px-3 py-2">
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
            {user?.role && (
              <span className="mt-1 inline-block rounded-full bg-mirqab-accent/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-mirqab-accent">
                {user.role.replace('_', ' ')}
              </span>
            )}
          </div>
          <DropdownItem onClick={() => logout()} className="hover:text-mirqab-danger">
            <LogOut className="h-4 w-4" />
            {t('topbar.signOut')}
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
