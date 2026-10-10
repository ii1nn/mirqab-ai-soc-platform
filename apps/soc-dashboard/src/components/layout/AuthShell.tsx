import { Globe2, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Shared chrome for Login / Register / Forgot / Reset password screens. */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  const { t, toggleLanguage } = useLanguage();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-mirqab-primary to-mirqab-surfaceElevated px-6 py-10">
      <button
        type="button"
        onClick={toggleLanguage}
        className="fixed top-5 start-5 flex items-center gap-1.5 rounded-full border border-mirqab-border bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 backdrop-blur-md transition hover:bg-white/10"
      >
        <Globe2 className="h-3.5 w-3.5" />
        {t('language.toggleTo')}
      </button>

      <div className="glass-card w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {/* text-[#fff]: solid brand-gradient fill in both themes, must stay literally white */}
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mirqab-brand text-[#fff] shadow-glow">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">{title}</h1>
            <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
          </div>
        </div>

        {children}

        {footer && <div className="mt-5 text-center text-xs text-slate-400">{footer}</div>}
      </div>
    </div>
  );
}
