import { AnimatePresence, motion } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';
import { useSecurityAlerts } from '../../hooks/useSecurityAlerts';
import { useSecurityScore } from '../../hooks/useSecurityScore';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function AppShell() {
  const { result } = useSecurityScore();
  useSecurityAlerts(result);
  const location = useLocation();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-mirqab-primary to-[#070b14] text-slate-100">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
