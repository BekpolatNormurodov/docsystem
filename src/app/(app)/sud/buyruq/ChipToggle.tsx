'use client';

import React from 'react';
import { Ico } from '@/ui';

/**
 * Bosiladigan chip — bir nechta tanlov uchun (checkbox o'rniga). Kattaligi >=44px (touch),
 * aria-pressed bilan screen-reader'ga tanlov holati aytiladi, focus ring saqlanadi (a11y).
 * Yordamchi `count` sonini o'ng chetiga chiqaradi. Klaviatura: Space/Enter — toggle.
 */
export function ChipToggle({ selected, onToggle, children, count, dot, disabled = false }: {
  selected: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  count?: number;
  dot?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={[
        'inline-flex min-h-[36px] items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-40',
        selected
          ? 'border-emerald-500/70 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 dark:border-emerald-400/50 dark:bg-emerald-400/15 dark:text-emerald-200'
          : 'border-line bg-surface text-fg hover:border-emerald-400/40 hover:bg-surface-2',
      ].join(' ')}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />}
      <span>{children}</span>
      {typeof count === 'number' && (
        <span className={[
          'ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums',
          selected ? 'bg-emerald-500/20 text-emerald-800 dark:bg-emerald-400/25 dark:text-emerald-100' : 'bg-surface-2 text-muted',
        ].join(' ')}>{count.toLocaleString()}</span>
      )}
      {selected && <Ico.check size={12} className="opacity-70" aria-hidden="true" />}
    </button>
  );
}
