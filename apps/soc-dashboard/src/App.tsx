import { type ReactElement, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AnalyticsPage } from './features/analytics/AnalyticsPage';
import { AuditLogsPage } from './features/audit-logs/AuditLogsPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { CitadelLiveViewPage } from './features/citadel/CitadelLiveViewPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DepartmentsPage } from './features/departments/DepartmentsPage';
import { DevicesPage } from './features/devices/DevicesPage';
import { IncidentMemoryPage } from './features/incident-memory/IncidentMemoryPage';
import { LiveAlertsPage } from './features/live-alerts/LiveAlertsPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { PoliciesPage } from './features/policies/PoliciesPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SecurityTestingPage } from './features/security-testing/SecurityTestingPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { ThreatMapPage } from './features/threat-map/ThreatMapPage';
import { TicketsPage } from './features/tickets/TicketsPage';
import { UserManagementPage } from './features/user-management/UserManagementPage';
import { useLanguage } from './i18n/LanguageContext';
import type { UserRole } from './services/auth.service';
import { useAuthStore } from './store/auth.store';

function RequireAuth({ children }: { children: ReactElement }) {
  const status = useAuthStore((state) => state.status);
  const { t } = useLanguage();

  if (status === 'idle' || status === 'authenticating') {
    return (
      <div className="flex h-screen items-center justify-center bg-mirqab-primary text-sm text-slate-400">
        {t('common.checkingSession')}
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return children;
}

/**
 * UX-only gate — hides a page a role has no reason to see and avoids it
 * rendering into an empty/degraded state. The actual security boundary is
 * the backend's own `@Roles(...)` guard on every route this ever calls;
 * this component's own role check is not, and must never become, a
 * substitute for that (see e.g. AuditLogsController's `@Roles(ADMIN,
 * SECURITY_ANALYST)` — that's what actually stops an IT_TECHNICIAN from
 * reading audit data, not this redirect).
 */
function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactElement }) {
  const role = useAuthStore((state) => state.user?.role);

  if (role && !roles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="alerts" element={<LiveAlertsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="citadel" element={<CitadelLiveViewPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="threat-map" element={<ThreatMapPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="incident-memory" element={<IncidentMemoryPage />} />
        <Route path="policies" element={<PoliciesPage />} />
        <Route
          path="users"
          element={
            <RequireRole roles={['ADMIN']}>
              <UserManagementPage />
            </RequireRole>
          }
        />
        <Route
          path="audit-logs"
          element={
            <RequireRole roles={['ADMIN', 'SECURITY_ANALYST']}>
              <AuditLogsPage />
            </RequireRole>
          }
        />
        <Route
          path="security-testing"
          element={
            <RequireRole roles={['ADMIN']}>
              <SecurityTestingPage />
            </RequireRole>
          }
        />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
