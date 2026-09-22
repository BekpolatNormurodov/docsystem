'use client';

import React, { useMemo, useState } from 'react';
import { Ico } from '@/ui';
import { useT } from '@/lib/i18n/client';
import { ChipToggle } from './ChipToggle';

interface Firm { code: string; shortName: string }
interface StatusItem { key: string; label: string; total: number; dot?: string }

/**
 * «Holat bo'yicha yangi Excel yaratish» — checkbox o'rniga chip-toggle'lar, real vaqtli
 * tanlangan mijozlar sonini ko'rsatadi. Yuklab olish oddiy GET (route stream qaytaradi).
 * A11y: har chip aria-pressed; keyboard bilan Space/Enter — toggle. Tanlanmagan bo'lsa
 * tugma disable qilinadi.
 */
export default function StatusExportForm({ firms, statuses, matrix }: {
  firms: Firm[];
  statuses: StatusItem[];
  matrix: Record<string, Record<string, number>>; // firm.code -> status -> count
}) {
  const t = useT();
  const defaultStatuses = new Set(['REGISTER', 'ALLOCATE', 'PENDING', 'IN_PROCESS']);
  const [selFirms, setSelFirms] = useState<Set<string>>(new Set(firms.map((f) => f.code)));
  const [selStatuses, setSelStatuses] = useState<Set<string>>(new Set(statuses.filter((s) => defaultStatuses.has(s.key)).map((s) => s.key)));

  const total = useMemo(() => {
    let n = 0;
    for (const f of selFirms) for (const s of selStatuses) n += matrix[f]?.[s] ?? 0;
    return n;
  }, [selFirms, selStatuses, matrix]);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    for (const f of selFirms) p.append('firm', f);
    for (const s of selStatuses) p.append('status', s);
    return `/sud/buyruq/export?${p.toString()}`;
  }, [selFirms, selStatuses]);

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    apply(next);
  };
  const disabled = selFirms.size === 0 || selStatuses.size === 0;

  return (
    <div className="mt-2 space-y-4">
      <fieldset>
        <legend className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <span>{t('Firma')}</span>
          <span className="text-muted/70">·</span>
          <button type="button" onClick={() => setSelFirms(new Set(firms.map((f) => f.code)))} className="text-emerald-700 hover:underline dark:text-emerald-300">{t('Hammasi')}</button>
          <button type="button" onClick={() => setSelFirms(new Set())} className="text-muted hover:underline">{t('Tozalash')}</button>
        </legend>
        <div className="flex flex-wrap gap-2">
          {firms.map((f) => (
            <ChipToggle key={f.code} selected={selFirms.has(f.code)} onToggle={() => toggle(selFirms, f.code, setSelFirms)}>
              {f.shortName}
            </ChipToggle>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <span>{t('Holat')}</span>
          <span className="text-muted/70">·</span>
          <button type="button" onClick={() => setSelStatuses(new Set(statuses.map((s) => s.key)))} className="text-emerald-700 hover:underline dark:text-emerald-300">{t('Hammasi')}</button>
          <button type="button" onClick={() => setSelStatuses(new Set(statuses.filter((s) => defaultStatuses.has(s.key)).map((s) => s.key)))} className="text-emerald-700 hover:underline dark:text-emerald-300">{t('Sudda turganlar')}</button>
          <button type="button" onClick={() => setSelStatuses(new Set())} className="text-muted hover:underline">{t('Tozalash')}</button>
        </legend>
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <ChipToggle key={s.key} selected={selStatuses.has(s.key)} onToggle={() => toggle(selStatuses, s.key, setSelStatuses)} count={s.total} dot={s.dot}>
              {s.label}
            </ChipToggle>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <div className="text-sm">
          <span className="text-muted">{t('Tanlangan')}:</span>{' '}
          <span className="tabular-nums font-semibold text-fg">{total.toLocaleString()}</span>{' '}
          <span className="text-muted">{t('ish')}</span>
        </div>
        <a
          href={disabled ? '#' : url}
          aria-disabled={disabled}
          onClick={(e) => { if (disabled) e.preventDefault(); }}
          className={`btn-primary ml-auto inline-flex items-center gap-1.5 ${disabled ? 'pointer-events-none opacity-40' : ''}`}
        >
          <Ico.download size={16} /> {t('Excel yuklab olish')}
        </a>
      </div>
    </div>
  );
}
