import clsx from 'clsx';
import { Eye, EyeOff } from 'lucide-react';
import { type InputHTMLAttributes, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}

/** Text input with a show/hide eye toggle, RTL-aware (icon sits on the logical "end" side). */
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={clsx(
          'w-full rounded-xl border border-mirqab-border bg-white/5 px-3 py-2 pe-10 text-sm text-white outline-none transition focus:border-mirqab-accent/60',
          className,
        )}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
        className="absolute end-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 transition hover:text-slate-200"
        tabIndex={-1}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
