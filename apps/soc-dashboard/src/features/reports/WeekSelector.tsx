import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useLanguage } from '../../i18n/LanguageContext';
import type { ReportWeek } from '../../types/domain';

const POPOVER_WIDTH = 256; // w-64

// timeZone: 'UTC' — see the matching comment in ReportsPage.tsx's
// formatDateOnly; same reason, same fix.
function formatRange(week: ReportWeek): string {
  const start = new Date(week.periodStart);
  const end = new Date(week.periodEnd);
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
}

interface WeekSelectorProps {
  weeks: ReportWeek[];
  selectedWeekStart: string;
  onSelect: (weekStart: string) => void;
}

/** Compact popover — same visual language (glass-panel, outside-click +
 * Escape to close) as components/ui/Dropdown.tsx, but two things differ:
 * (1) self-managed open state rather than reusing that component directly,
 * since Dropdown's children have no way to close the menu on selection;
 * (2) portaled to document.body rather than positioned via a `relative`
 * wrapper. The trigger sits inside a `.glass-card` Card, and `.glass-card`
 * uses `backdrop-filter` — which, like `transform`, creates a new CSS
 * stacking context — so a same-DOM-position absolute popover was getting
 * visually trapped under the *next* Card lower on the page (same class of
 * bug as the Incident panel's earlier fixed-positioning issue, different
 * CSS property). Portaling escapes that entirely; position is computed
 * from the trigger's real screen coordinates instead of relying on CSS
 * `absolute` positioning against a `relative` ancestor. */
export function WeekSelector({ weeks, selectedWeekStart, onSelect }: WeekSelectorProps) {
  const { t, dir } = useLanguage();
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
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

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // "end"-aligned with the trigger, like the original `end-0` class —
      // right edge in LTR, left edge in RTL — then clamped so it never
      // renders off-screen.
      const rawLeft = dir === 'rtl' ? rect.left : rect.right - POPOVER_WIDTH;
      const left = Math.min(Math.max(rawLeft, 8), window.innerWidth - POPOVER_WIDTH - 8);
      setPopoverPos({ top: rect.bottom + 8, left });
    }
    setOpen((v) => !v);
  }

  const current = weeks[0];
  const previous = weeks[1];
  const selected = weeks.find((w) => w.periodStart === selectedWeekStart);
  const older = weeks.slice(2);

  function pick(weekStart: string) {
    onSelect(weekStart);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-label={t('reports.weekSelector.selectWeek')}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-mirqab-primary/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none transition hover:bg-white/5 focus:border-mirqab-accent/50"
      >
        <span className="font-medium">{selected ? formatRange(selected) : '…'}</span>
        <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            style={{ top: popoverPos.top, left: popoverPos.left, width: POPOVER_WIDTH }}
            className="glass-panel fixed z-[70] max-h-80 overflow-y-auto p-1"
          >
            {current && (
              <WeekOption
                week={current}
                label={t('reports.weekSelector.currentWeek')}
                selected={selectedWeekStart === current.periodStart}
                onClick={() => pick(current.periodStart)}
              />
            )}
            {previous && (
              <WeekOption
                week={previous}
                label={t('reports.weekSelector.previousWeek')}
                selected={selectedWeekStart === previous.periodStart}
                onClick={() => pick(previous.periodStart)}
              />
            )}
            {older.length > 0 && (
              <>
                <p className="mt-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t('reports.weekSelector.olderWeeks')}
                </p>
                {older.map((week) => (
                  <WeekOption
                    key={week.periodStart}
                    week={week}
                    selected={selectedWeekStart === week.periodStart}
                    onClick={() => pick(week.periodStart)}
                  />
                ))}
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function WeekOption({
  week,
  label,
  selected,
  onClick,
}: {
  week: ReportWeek;
  label?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-xs transition',
        selected ? 'bg-mirqab-accent/15 text-mirqab-accent' : 'text-slate-300 hover:bg-white/5 hover:text-white',
      )}
    >
      <span>
        {formatRange(week)}
        {label && <span className="ms-1.5 text-[10px] text-slate-500">· {label}</span>}
      </span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}
