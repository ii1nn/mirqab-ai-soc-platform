import { Loader2, ShieldCheck, WifiOff } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input, Label } from '../../components/ui/Input';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { useAuthStore } from '../../store/auth.store';

const ERROR_COPY: Record<string, string> = {
  invalid_credentials: 'Invalid email or password.',
  network_error: "Couldn't reach the server. Make sure the backend is running.",
};

export function LoginPage() {
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
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
    <div className="titlebar-drag flex h-screen items-center justify-center bg-gradient-to-b from-mirqab-primary to-[#070b14] px-6">
      <form onSubmit={handleSubmit} className="titlebar-no-drag glass-card w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mirqab-accent/10 text-mirqab-accent shadow-glow">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-white">Sign in to Mirqab</h1>
          <p className="text-sm text-slate-400">Endpoint protection for this device</p>
        </div>

        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mb-4"
          placeholder="you@company.com"
        />

        <Label htmlFor="password">Password</Label>
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
            className={
              error === 'network_error'
                ? 'mb-3 flex items-start gap-2 rounded-lg border border-mirqab-warning/30 bg-mirqab-warning/10 px-3 py-2'
                : 'mb-3 flex items-start gap-2 rounded-lg border border-mirqab-danger/25 bg-mirqab-danger/5 px-3 py-2'
            }
          >
            {error === 'network_error' && (
              <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mirqab-warning" />
            )}
            <p
              className={
                error === 'network_error'
                  ? 'text-xs font-medium text-mirqab-warning'
                  : 'text-xs font-medium text-mirqab-danger'
              }
            >
              {ERROR_COPY[error] ?? ERROR_COPY.invalid_credentials}
            </p>
          </div>
        )}

        <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
