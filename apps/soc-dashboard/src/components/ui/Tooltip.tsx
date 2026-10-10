import clsx from 'clsx';
import { type ReactNode, useId, useState } from 'react';

interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}

/** Minimal hover/focus tooltip — shows on both mouse hover and keyboard
 * focus so the hint isn't mouse-only (accessibility foundation, Phase 1-I). */
export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span aria-describedby={visible ? id : undefined}>{children}</span>
      {visible && (
        <span
          id={id}
          role="tooltip"
          className={clsx(
            'pointer-events-none absolute z-30 whitespace-nowrap rounded-lg border border-white/10 bg-mirqab-surfaceElevated px-2.5 py-1.5 text-xs text-slate-200 shadow-xl',
            'start-1/2 -translate-x-1/2',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
