import clsx from 'clsx';
import { type ReactNode, useEffect, useRef, useState } from 'react';

interface DropdownProps {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
}

/** Shared menu primitive — closes on outside click and Escape. Extracted
 * from the Topbar's original inline profile-menu implementation so any
 * future menu (notifications, row actions, etc.) shares the same behavior. */
export function Dropdown({ trigger, children, align = 'end', className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div
          role="menu"
          className={clsx(
            'glass-panel absolute z-20 mt-2 min-w-[12rem] p-1',
            align === 'end' ? 'end-0' : 'start-0',
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="menuitem"
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-slate-300 transition hover:bg-white/5 hover:text-white',
        className,
      )}
      {...props}
    />
  );
}
