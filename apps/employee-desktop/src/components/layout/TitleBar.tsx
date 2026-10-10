import { Minus, ShieldCheck, Square, X } from 'lucide-react';

export function TitleBar() {
  return (
    <div className="titlebar-drag flex h-10 shrink-0 items-center justify-between border-b border-mirqab-border bg-mirqab-secondary/80 px-3">
      <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
        <ShieldCheck className="h-4 w-4 text-mirqab-accent" />
        MIRQAB <span className="font-normal text-slate-500">Employee</span>
      </div>
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={() => window.mirqab.window.minimize()}
          className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
          aria-label="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => window.mirqab.window.maximizeToggle()}
          className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
          aria-label="Maximize"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          onClick={() => window.mirqab.window.close()}
          className="rounded-md p-1.5 text-slate-400 hover:bg-mirqab-danger/80 hover:text-white"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
