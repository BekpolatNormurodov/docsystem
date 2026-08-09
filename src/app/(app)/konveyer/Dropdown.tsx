'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface Opt { value: string; label: string; hint?: string }

/** A minimal, hydration-safe custom dropdown (no render-phase side effects).
 *  Built for the Hisobot page where the shared @/ui Select crashed. */
export function Dropdown({ value, options, onChange, className = '', placeholder = 'Tanlang' }: {
  value: string; options: Opt[]; onChange: (v: string) => void; className?: string; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);

  const sel = options.find((o) => o.value === value);

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-surface pl-3.5 pr-3 text-sm font-medium outline-none transition-colors hover:border-brand-500/60 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
      >
        <span className={`truncate ${sel ? '' : 'text-muted'}`}>{sel?.label ?? placeholder}</span>
        <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {open && (
        <div role="listbox" className="absolute left-0 right-0 z-50 mt-1.5 max-h-72 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-2xl">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${active ? 'bg-brand-500/10 font-medium text-brand-600 dark:text-brand-400' : 'hover:bg-surface-2'}`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-[11px] text-muted">{o.hint}</span>}
                {active && <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
