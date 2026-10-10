import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { Button } from '../../components/ui/Button';
import { Input, Label } from '../../components/ui/Input';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuthStore } from '../../store/auth.store';

export function RegisterPage() {
  const { t } = useLanguage();
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const errorDetail = useAuthStore((state) => state.errorDetail);
  const signup = useAuthStore((state) => state.signup);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  // Set once signup succeeds — the account is created inactive and pending
  // admin approval, so there's no session to land the user in; show a
  // confirmation instead of navigating into the app.
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);

    if (password !== confirmPassword) {
      setLocalError(t('auth.signup.passwordMismatch'));
      return;
    }

    try {
      const message = await signup({ firstName, lastName, email, password, confirmPassword });
      setPendingMessage(message);
    } catch {
      // Failure is already surfaced via the store's `error` field.
    }
  }

  const isSubmitting = status === 'authenticating';
  const displayError = localError ?? (error ? t(`auth.errors.${error}`) : null);

  if (pendingMessage) {
    return (
      <AuthShell
        title={t('auth.signup.pendingTitle')}
        subtitle={pendingMessage}
        footer={
          <Link to="/login" className="font-medium text-mirqab-accent hover:underline">
            {t('auth.signup.signIn')}
          </Link>
        }
      >
        <></>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('auth.signup.title')}
      subtitle={t('auth.signup.subtitle')}
      footer={
        <>
          {t('auth.signup.haveAccount')}{' '}
          <Link to="/login" className="font-medium text-mirqab-accent hover:underline">
            {t('auth.signup.signIn')}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="firstName">{t('auth.firstName')}</Label>
            <Input
              id="firstName"
              type="text"
              required
              autoFocus
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder={t('auth.signup.firstNamePlaceholder')}
            />
          </div>
          <div>
            <Label htmlFor="lastName">{t('auth.lastName')}</Label>
            <Input
              id="lastName"
              type="text"
              required
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder={t('auth.signup.lastNamePlaceholder')}
            />
          </div>
        </div>

        <Label htmlFor="email">{t('auth.workEmail')}</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mb-4"
          placeholder={t('auth.emailPlaceholder')}
        />

        <Label htmlFor="password">{t('auth.password')}</Label>
        <PasswordInput
          id="password"
          required
          minLength={10}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mb-1"
          placeholder="••••••••"
        />
        <p className="mb-3 text-[11px] text-slate-500">{t('auth.signup.passwordHint')}</p>

        <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
        <PasswordInput
          id="confirmPassword"
          required
          minLength={10}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="mb-2"
          placeholder="••••••••"
        />

        {displayError && (
          <div className="mb-3">
            <p className="text-xs font-medium text-mirqab-danger">{displayError}</p>
            {/* Raw backend/network detail — helps while wiring the backend up locally. */}
            {!localError && errorDetail && (
              <p className="mt-1 text-[11px] text-slate-500">{errorDetail}</p>
            )}
          </div>
        )}

        <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('auth.signup.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
