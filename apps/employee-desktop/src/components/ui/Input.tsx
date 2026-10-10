import clsx from 'clsx';
import type { InputHTMLAttributes, LabelHTMLAttributes } from 'react';

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      {...props}
      className={clsx('mb-1 block text-xs font-medium text-slate-400', props.className)}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full rounded-xl border border-mirqab-border bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-mirqab-accent/60',
        className,
      )}
    />
  );
}
