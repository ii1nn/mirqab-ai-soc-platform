import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { Button } from '../../components/ui/Button';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { useLanguage } from '../../i18n/LanguageContext';
import { authService } from '../../services/auth.service';

export function ResetPasswordPage() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError(t('auth.resetPassword.missingToken'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('auth.signup.passwordMismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      await authService.resetPassword(token, newPassword, confirmPassword);
      setSuccess(true);
    } catch {
      setError(t('auth.resetPassword.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell title={t('auth.resetPassword.title')} subtitle={t('auth.resetPassword.subtitle')}>
      {success ? (
        <div className="text-center">
          <h2 className="text-sm font-semibold text-white">
            {t('auth.resetPassword.successTitle')}
          </h2>
          <p className="mt-2 text-xs text-slate-400">{t('auth.resetPassword.successHint')}</p>
          <Link to="/login">
            <Button className="mt-4 w-full">{t('auth.resetPassword.goToLogin')}</Button>
          </Link>
        </div>
      ) : !token ? (
        <div className="text-center">
          <p className="text-xs font-medium text-mirqab-danger">
            {t('auth.resetPassword.missingToken')}
          </p>
          <Link
            to="/forgot-password"
            className="mt-4 block text-xs text-mirqab-accent hover:underline"
          >
            {t('auth.forgotPassword.title')}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="newPassword">
            {t('auth.resetPassword.newPassword')}
          </label>
          <PasswordInput
            id="newPassword"
            required
            minLength={10}
            autoFocus
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="mb-4"
            placeholder="••••••••"
          />

          <label
            className="mb-1 block text-xs font-medium text-slate-400"
            htmlFor="confirmPassword"
          >
            {t('auth.confirmPassword')}
          </label>
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

          {error && <p className="mb-3 text-xs font-medium text-mirqab-danger">{error}</p>}

          <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t('auth.resetPassword.submit')
            )}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
