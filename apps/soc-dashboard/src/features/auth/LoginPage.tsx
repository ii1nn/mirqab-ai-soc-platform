import clsx from 'clsx';
import { Loader2, WifiOff } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { Button } from '../../components/ui/Button';
import { Input, Label } from '../../components/ui/Input';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuthStore } from '../../store/auth.store';

export function LoginPage() {
  const { t } = useLanguage();
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const errorDetail = useAuthStore((state) => state.errorDetail);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (status === 'authenticated') {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch {
      // Failure is already surfaced via the store's `error` field.
    }
  }

  const isSubmitting = status === 'authenticating';

  return (
    <AuthShell
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      footer={
        <>
          {t('auth.login.noAccount')}{' '}
          <Link to="/register" className="font-medium text-mirqab-accent hover:underline">
            {t('auth.login.createAccount')}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Label htmlFor="email">{t('auth.workEmail')}</Label>
        <Input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mb-4"
          placeholder={t('auth.emailPlaceholder')}
        />

        <div className="mb-1 flex items-center justify-between">
          <Label htmlFor="password" className="mb-0">
            {t('auth.password')}
          </Label>
          <Link to="/forgot-password" className="text-xs text-mirqab-accent hover:underline">
            {t('auth.login.forgotPassword')}
          </Link>
        </div>
        <PasswordInput
          id="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mb-2"
          placeholder="••••••••"
        />

        {error && (
          <div
            className={clsx(
              'mb-3 flex items-start gap-2 rounded-lg border px-3 py-2',
              error === 'network_error'
                ? 'border-mirqab-warning/30 bg-mirqab-warning/10'
                : 'border-mirqab-danger/25 bg-mirqab-danger/5',
            )}
          >
            {error === 'network_error' && (
              <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mirqab-warning" />
            )}
            <div>
              <p
                className={clsx(
                  'text-xs font-medium',
                  error === 'network_error' ? 'text-mirqab-warning' : 'text-mirqab-danger',
                )}
              >
                {t(`auth.errors.${error}`)}
              </p>
              {/* Raw backend/network detail — helps while wiring the backend up locally. */}
              {errorDetail && <p className="mt-1 text-[11px] text-slate-500">{errorDetail}</p>}
            </div>
          </div>
        )}

        <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('auth.login.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
