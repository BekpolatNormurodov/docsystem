'use client';

import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { SidebarRailContext } from '@/ui/AppShell';

export interface SnapOpt { id: number; label: string; cases: number }

// dd.mm.yyyy -> dd.mm.yy (compact for the narrow sidebar). Anchored to a full date so any other
// label shape (e.g. konveyerSnapshots' "#123" no-date fallback) passes through untouched.
const short = (label: string) => label.replace(/^(\d{2}\.\d{2}\.)\d{2}(\d{2})$/, '$1$2');
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

/**
 * Sidebar snapshot-date picker shared by the whole Boshqaruv pipeline. Stores the choice in a
 * cookie (konv_s) and refreshes, so every step-page (and Hisobot) re-renders on that one snapshot.
 *
 * The open panel is a portal to <body> with fixed positioning computed from the trigger's rect —
 * the sidebar nav is an overflow-auto, transformed container that would otherwise clip it (or a
 * native <select> would render an ugly OS popup). When the sidebar is collapsed to the rail, the
 * trigger folds to a calendar icon + tiny date so the date never simply disappears.
 */
export function SnapshotPicker({ options, value }: { options: SnapOpt[]; value: number }) {
  const router = useRouter();
  const rail = useContext(SidebarRailContext);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const place = () => { if (btnRef.current) setRect(btnRef.current.getBoundingClientRect()); };
  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // capture=true so the sidebar's own scroll (not just window) keeps the panel glued to the trigger.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (options.length === 0) return null;
  const sel = options.find((o) => o.id === value) ?? options[0];

  const pick = (id: number) => {
    setOpen(false);
    document.cookie = `konv_s=${id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  };

  const panelWidth = rect ? Math.max(rect.width, 184) : 184;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Hisobot sanasi"
        title={`Hisobot sanasi: ${short(sel.label)}`}
        className={cx(
          'flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-sm outline-none transition-all duration-200 hover:border-brand-500/50 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30',
          // Collapsed rail (lg only — mobile keeps the full chip): fold to a borderless icon + tiny date.
          rail && 'lg:flex-col lg:gap-0.5 lg:border-transparent lg:bg-transparent lg:px-1 lg:shadow-none lg:hover:bg-surface-2',
        )}
      >
        <CalendarIcon className={cx('h-[15px] w-[15px] shrink-0 text-brand-600 dark:text-brand-400', rail && 'lg:h-[18px] lg:w-[18px]')} />
        <span className={cx('flex-1 text-left font-semibold tabular-nums text-fg', rail && 'lg:flex-none lg:text-[10px] lg:leading-none')}>{short(sel.label)}</span>
        <svg
          className={cx('h-4 w-4 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180', rail && 'lg:hidden')}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {mounted && open && rect && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          style={{ position: 'fixed', top: rect.bottom + 6, left: rect.left, width: panelWidth, zIndex: 60 }}
          className="max-h-72 animate-fade-in overflow-auto rounded-xl border border-line bg-surface p-1 shadow-xl"
        >
          {options.map((o) => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(o.id)}
                className={cx(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                  active ? 'bg-brand-500/10 font-semibold text-brand-700 dark:text-brand-300' : 'hover:bg-surface-2',
                )}
              >
                <span className="tabular-nums">{short(o.label)}</span>
                <span className="text-[11px] tabular-nums text-muted">{o.cases.toLocaleString('ru-RU')} ta</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
