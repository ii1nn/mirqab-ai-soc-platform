import { type ReactElement, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AiScanPage } from './features/ai-scan/AiScanPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DeviceHealthPage } from './features/device-health/DeviceHealthPage';
import { DeviceInfoPage } from './features/device-info/DeviceInfoPage';
import { IncidentHistoryPage } from './features/incident-history/IncidentHistoryPage';
import { LoginPage } from './features/login/LoginPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { RecommendedFixesPage } from './features/recommended-fixes/RecommendedFixesPage';
import { useAuthStore } from './store/auth.store';

function RequireAuth({ children }: { children: ReactElement }) {
  const status = useAuthStore((state) => state.status);

  if (status === 'idle' || status === 'authenticating') {
    return (
      <div className="flex h-screen items-center justify-center bg-mirqab-primary text-sm text-slate-400">
        Checking your session…
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
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
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="device-health" element={<DeviceHealthPage />} />
        <Route path="device-info" element={<DeviceInfoPage />} />
        <Route path="scan" element={<AiScanPage />} />
        <Route path="incidents" element={<IncidentHistoryPage />} />
        <Route path="fixes" element={<RecommendedFixesPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
    </Routes>
  );
}
