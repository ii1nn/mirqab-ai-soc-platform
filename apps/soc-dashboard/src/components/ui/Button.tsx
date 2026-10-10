import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
  size?: 'sm' | 'md' | 'lg';
}

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  // text-[#fff] (not text-white) here on purpose — these sit on a solid
  // brand-color fill in both themes, so the label must stay literally white
  // rather than following the theme-reactive `white` token (see
  // tailwind.config.ts / src/styles/index.css's light-mode override).
  primary: 'bg-mirqab-brand text-[#fff] hover:brightness-110 shadow-glow',
  secondary: 'bg-white/10 text-slate-100 hover:bg-white/15 border border-white/10',
  ghost: 'text-slate-300 hover:text-white hover:bg-white/5',
  danger:
    'bg-mirqab-danger/15 text-mirqab-danger border border-mirqab-danger/30 hover:bg-mirqab-danger/25',
  'danger-solid': 'bg-mirqab-danger text-[#fff] shadow-glow-red hover:brightness-110',
};

const SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}
