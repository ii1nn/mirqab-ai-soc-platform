import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-mirqab-accent text-mirqab-primary hover:brightness-110 shadow-glow',
  secondary: 'bg-white/10 text-slate-100 hover:bg-white/15 border border-white/10',
  ghost: 'text-slate-300 hover:text-white hover:bg-white/5',
};

export function Button({ variant = 'primary', className, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}
