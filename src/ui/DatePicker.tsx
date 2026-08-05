'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  UZ_MONTHS_LAT, WEEKDAYS_LAT, monthGrid, isValidDay, isoToDmy, dmyToIso, isoMonth, isoDay, shiftMonth,
} from '../core/calendar';
import { maskDmy } from '../core/mask';
import { Ico } from './icons';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

/** Today as 'YYYY-MM-DD' in the browser's own zone. */
function todayIso(): string {
  const n = new Date();
  return isoDay(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
}

const inRange = (iso: string, min?: string, max?: string) =>
  (!min || iso >= min) && (!max || iso <= max);

/**
 * Popover date picker. The text box stays authoritative — you can type DD.MM.YYYY straight
 * in — and the grid is a shortcut on top of it. Value in/out is always ISO 'YYYY-MM-DD'.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  id,
  error,
  hint,
  placeholder = 'kk.oo.yyyy',
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  id?: string;
  error?: boolean;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  /** For standalone use (filters), where there is no <Shell> label to point at. */
  ariaLabel?: string;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const gridId = `${inputId}-grid`;

  const today = useMemo(todayIso, []);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => isoToDmy(value));
  // Which month the grid shows. Follows `value`, falls back to today.
  const [view, setView] = useState(() => (isValidDay(value) ? value.slice(0, 7) : isoMonth(new Date())));
  const [focusDay, setFocusDay] = useState(() => (isValidDay(value) ? value : today));

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Keep the text box in step when the form resets or the parent sets a value.
  useEffect(() => {
    setText(isoToDmy(value));
    if (isValidDay(value)) {
      setView(value.slice(0, 7));
      setFocusDay(value);
    }
  }, [value]);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) inputRef.current?.focus();
  }, []);

  // Dismiss on outside click / Escape (ux: popover-dismiss).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  const commit = (iso: string) => {
    if (!inRange(iso, min, max)) return;
    onChange(iso);
    setText(isoToDmy(iso));
    setView(iso.slice(0, 7));
    setFocusDay(iso);
    close(true);
  };

  const onType = (raw: string) => {
    const masked = maskDmy(raw);
    setText(masked);
    const iso = dmyToIso(masked);
    if (iso && inRange(iso, min, max)) {
      onChange(iso);
      setView(iso.slice(0, 7));
      setFocusDay(iso);
    } else if (masked === '') {
      onChange('');
    }
  };

  /** Typed garbage snaps back to the last good value rather than lingering half-written. */
  const onBlurText = () => {
    const iso = dmyToIso(text);
    if (iso && inRange(iso, min, max)) return;
    setText(isoToDmy(value));
  };

  const moveFocus = (deltaDays: number) => {
    const d = new Date(`${focusDay}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    const next = isoDay(d);
    setFocusDay(next);
    setView(next.slice(0, 7));
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in map) { e.preventDefault(); moveFocus(map[e.key]!); return; }
    if (e.key === 'PageUp') { e.preventDefault(); setView((v) => shiftMonth(v, -1)); return; }
    if (e.key === 'PageDown') { e.preventDefault(); setView((v) => shiftMonth(v, 1)); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(focusDay); }
  };

  // Roving tabindex: the focused day owns focus while the grid is open.
  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>('[data-focused="true"]')?.focus();
  }, [open, focusDay]);

  const [vy, vm] = view.split('-').map(Number);
  const cells = monthGrid(view);
  const prevMonth = shiftMonth(view, -1);
  const nextMonth = shiftMonth(view, 1);
  // A month is unreachable only when *every* day in it is out of range.
  const prevBlocked = !!min && `${prevMonth}-31` < min;
  const nextBlocked = !!max && `${nextMonth}-01` > max;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onBlur={onBlurText}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); }
          }}
          placeholder={placeholder}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel}
          aria-invalid={error || undefined}
          aria-describedby={hint ? `${inputId}-hint` : undefined}
          className={cx(
            'field-input pr-10 tabular-nums',
            error && 'border-rose-500/60 focus:border-rose-500 focus:ring-rose-500/25',
          )}
        />
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setFocusDay(isValidDay(value) ? value : today); }}
          disabled={disabled}
          aria-label={open ? 'Kalendarni yopish' : 'Kalendarni ochish'}
          aria-expanded={open}
          aria-controls={open ? gridId : undefined}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Ico.calendar size={16} />
        </button>
      </div>

      {open && (
        <div
          id={gridId}
          role="dialog"
          aria-label="Sana tanlash"
          className="absolute left-0 top-full z-50 mt-2 w-[19rem] rounded-xl border border-line bg-surface p-3 shadow-xl shadow-slate-900/10 animate-fade-in dark:shadow-black/40"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              // Functional updater: two clicks landing in one React batch would otherwise both
              // read the same stale `view` and advance a single month.
              onClick={() => setView((v) => shiftMonth(v, -1))}
              disabled={prevBlocked}
              aria-label="Oldingi oy"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
            >
              <Ico.chevronLeft size={18} />
            </button>

            <div className="text-sm font-semibold">
              {UZ_MONTHS_LAT[vm! - 1]} <span className="tabular-nums text-muted">{vy}</span>
            </div>

            <button
              type="button"
              onClick={() => setView((v) => shiftMonth(v, 1))}
              disabled={nextBlocked}
              aria-label="Keyingi oy"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
            >
              <Ico.chevron size={18} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {WEEKDAYS_LAT.map((w, i) => (
              <div
                key={w}
                className={cx(
                  'py-1 text-center text-[10px] font-semibold uppercase tracking-wide',
                  i >= 5 ? 'text-rose-500/70' : 'text-muted',
                )}
              >
                {w}
              </div>
            ))}
          </div>

          <div ref={gridRef} className="grid grid-cols-7 gap-0.5" onKeyDown={onGridKey}>
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} />;
              const iso = `${view}-${String(d).padStart(2, '0')}`;
              const isSel = iso === value;
              const isToday = iso === today;
              const isFocus = iso === focusDay;
              const blocked = !inRange(iso, min, max);

              return (
                <button
                  key={iso}
                  type="button"
                  data-focused={isFocus || undefined}
                  tabIndex={isFocus ? 0 : -1}
                  disabled={blocked}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSel}
                  onClick={() => commit(iso)}
                  className={cx(
                    'relative grid h-9 place-items-center rounded-lg text-[13px] font-medium tabular-nums transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                    blocked && 'cursor-not-allowed text-muted/40',
                    !blocked && isSel && 'bg-brand-600 text-white hover:bg-brand-700',
                    !blocked && !isSel && 'hover:bg-surface-2',
                    !blocked && !isSel && isToday && 'text-brand-600 dark:text-brand-400',
                    !blocked && !isSel && !isToday && i % 7 >= 5 && 'text-rose-500/80',
                  )}
                >
                  {d}
                  {/* Today keeps a marker even while selected — colour is never the only cue. */}
                  {isToday && (
                    <span
                      aria-hidden
                      className={cx(
                        'absolute bottom-1 h-1 w-1 rounded-full',
                        isSel ? 'bg-white' : 'bg-brand-600 dark:bg-brand-400',
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
            <button
              type="button"
              onClick={() => commit(today)}
              disabled={!inRange(today, min, max)}
              className="btn-ghost px-2.5 py-1 text-xs disabled:pointer-events-none disabled:opacity-40"
            >
              Bugun
            </button>
            <button
              type="button"
              onClick={() => { onChange(''); setText(''); close(true); }}
              className="btn-ghost px-2.5 py-1 text-xs text-muted"
            >
              Tozalash
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
