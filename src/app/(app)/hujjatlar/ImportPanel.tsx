'use client';

import { useState } from 'react';
import { Ico } from '@/ui';

/**
 * Collapsible container that folds the portfolio import (upload form + history) into the Hujjatlar
 * page — import no longer has its own nav tab. Defaults open on an empty account (nothing to show
 * yet, so the form is the point), collapsed once portfolios exist so the date cards stay the focus.
 */
export function ImportPanel({
  defaultOpen,
  count,
  children,
}: {
  defaultOpen: boolean;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="card mb-6 overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-surface-2"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
          <Ico.add size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Portfel import</span>
          <span className="block text-xs text-muted">
            Yangi portfel + istisno faylini yuklang{count > 0 ? ` · ${count} ta yuklangan` : ''}
          </span>
        </span>
        <Ico.chevron size={18} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && <div className="space-y-6 border-t border-line p-4 sm:p-6">{children}</div>}
    </section>
  );
}
