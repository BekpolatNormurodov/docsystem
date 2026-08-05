'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Ico } from './icons';

export interface Option {
  value: string;
  label: string;
  /** Optional colour dot (e.g. status tone). */
  dot?: string;
}

/** Fold the Uzbek Latin apostrophe forms together so oʻ/o'/o` all match each other. */
const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ‘’`']/g, "'");

/**
 * Pro dropdown — keyboard accessible (Enter/Space/Esc/arrows), click-outside close,
 * colour dots, and a visible focus ring. Replaces the native <select> in filters.
 *
 * Lists of `searchAfter` options or more get a filter box; below that it is noise.
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = 'Tanlang',
  label,
  className = '',
  searchAfter = 8,
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  /** Show the search box once the list reaches this many options. 0 = always. */
  searchAfter?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const searchable = options.length >= searchAfter;

  const filtered = useMemo(() => {
    const needle = norm(q.trim());
    if (!needle) return options;
    return options.filter((o) => norm(o.label).includes(needle));
  }, [options, q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Opening starts from a clean list and puts the caret in the search box.
  useEffect(() => {
    if (open) {
      setActive(0);
      search.current?.focus();
    } else {
      setQ('');
    }
  }, [open]);

  // A stale index would highlight a row that filtering just removed.
  useEffect(() => setActive(0), [q]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[active];
      if (o) pick(o.value);
    }
  }

  return (
    <div ref={box} className={`relative ${className}`} onKeyDown={onKey}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className="field-input flex cursor-pointer items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${selected.dot}`} />}
          <span className={`truncate ${selected ? '' : 'text-muted'}`}>{selected?.label ?? placeholder}</span>
        </span>
        <span className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}>
          <Ico.chevron size={14} />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
          {searchable && (
            <div className="border-b border-line p-2">
              <input
                ref={search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Qidirish…"
                aria-label={label ? `${label} — qidirish` : 'Qidirish'}
                className="field-input h-9 py-0 text-sm"
              />
            </div>
          )}

          <ul ref={listRef} role="listbox" className="max-h-64 overflow-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted">Topilmadi</li>
            ) : (
              filtered.map((o, i) => {
                const sel = o.value === value;
                return (
                  <li key={o.value || 'all'} role="option" aria-selected={sel}>
                    <button
                      type="button"
                      data-active={i === active || undefined}
                      onClick={() => pick(o.value)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        sel ? 'bg-brand-600 text-white' : i === active ? 'bg-surface-2 text-fg' : 'text-fg hover:bg-surface-2'
                      }`}
                    >
                      {o.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${o.dot}`} />}
                      <span className="truncate">{o.label}</span>
                      {sel && <span className="ml-auto"><Ico.check size={14} /></span>}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
