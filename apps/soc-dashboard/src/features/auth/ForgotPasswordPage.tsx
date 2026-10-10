import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { Button } from '../../components/ui/Button';
import { Input, Label } from '../../components/ui/Input';
import { useLanguage } from '../../i18n/LanguageContext';
import { authService } from '../../services/auth.service';

export function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string } | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await authService.forgotPassword(email);
      setResult(response);
    } catch {
      setError(t('auth.forgotPassword.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={t('auth.forgotPassword.title')}
      subtitle={t('auth.forgotPassword.subtitle')}
      footer={
        <Link to="/login" className="font-medium text-mirqab-accent hover:underline">
          {t('auth.forgotPassword.backToLogin')}
        </Link>
      }
    >
      {result ? (
        <div className="text-center">
          <h2 className="text-sm font-semibold text-white">
            {t('auth.forgotPassword.successTitle')}
          </h2>
          <p className="mt-2 text-xs text-slate-400">{t('auth.forgotPassword.successHint')}</p>
        </div>
      ) : (
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

          {error && <p className="mb-3 text-xs font-medium text-mirqab-danger">{error}</p>}

          <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t('auth.forgotPassword.submit')
            )}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
