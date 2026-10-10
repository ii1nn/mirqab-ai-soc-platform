import clsx from 'clsx';
import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      {...props}
      className={clsx('mb-1 block text-xs font-medium text-slate-400', props.className)}
    />
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Rendered inline at the end of the field (e.g. a unit or icon button). */
  trailing?: ReactNode;
  error?: boolean;
}

export function Input({ className, trailing, error, ...props }: InputProps) {
  return (
    <div className="relative">
      <input
        {...props}
        className={clsx(
          'w-full rounded-xl border bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-500',
          error
            ? 'border-mirqab-danger/60 focus:border-mirqab-danger'
            : 'border-mirqab-border focus:border-mirqab-accent/60',
          trailing && 'pe-10',
          className,
        )}
      />
      {trailing && (
        <div className="absolute inset-y-0 end-0 flex items-center pe-3">{trailing}</div>
      )}
    </div>
  );
}
