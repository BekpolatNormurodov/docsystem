'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FILTERABLE_ACTIONS, actionLabel } from '@/lib/audit-labels';
import { Ico } from '@/ui/icons';
import { DatePicker } from '@/ui/DatePicker';
import { Dropdown } from '../konveyer/Dropdown';

const inputCls =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

export function JurnalFilters({ action, q, from, to, showUser = true }: { action: string; q: string; from: string; to: string; showUser?: boolean }) {
  const router = useRouter();
  const [a, setA] = useState(action || 'all');
  const [text, setText] = useState(q || '');
  const [f, setF] = useState(from || '');
  const [t, setT] = useState(to || '');

  const buildParams = (aa = a, qq = text, ff = f, tt = t) => {
    const p = new URLSearchParams();
    if (aa && aa !== 'all') p.set('action', aa);
    if (showUser && qq.trim()) p.set('q', qq.trim());
    if (ff) p.set('from', ff);
    if (tt) p.set('to', tt);
    return p;
  };
  const apply = (aa = a, qq = text, ff = f, tt = t) => {
    const p = buildParams(aa, qq, ff, tt);
    router.push(`/jurnal${p.toString() ? `?${p}` : ''}`);
  };
  // Auto-apply the username search as you type (debounced) — no «Filtr» button.
  useEffect(() => {
    if (text.trim() === (q || '').trim()) return;
    const id = setTimeout(() => apply(a, text, f, t), 400);
    return () => clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasFilter = !!(action || q || from || to);
  const exportParams = buildParams().toString();

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Amaliyotlar</span>
        <Dropdown
          value={a}
          options={[{ value: 'all', label: 'Barchasi' }, ...FILTERABLE_ACTIONS.map((x) => ({ value: x, label: actionLabel(x) }))]}
          onChange={(v) => { setA(v); apply(v); }}
          className="min-w-[210px]"
        />
      </label>

      {showUser && (
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Foydalanuvchi</span>
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input className={`${inputCls} pl-9`} value={text} onChange={(e) => setText(e.target.value)} placeholder="login bo‘yicha…" />
          </div>
        </div>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-muted">Dan</span>
        <DatePicker value={f} onChange={(v) => { setF(v); apply(a, text, v, t); }} max={t || undefined} ariaLabel="Dan (sana)" />
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted">Gacha</span>
        <DatePicker value={t} onChange={(v) => { setT(v); apply(a, text, f, v); }} min={f || undefined} ariaLabel="Gacha (sana)" />
      </div>

      {hasFilter && (
        <button onClick={() => { setA('all'); setText(''); setF(''); setT(''); router.push('/jurnal'); }} className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg">
          Tozalash
        </button>
      )}

      <a
        href={`/jurnal/export${exportParams ? `?${exportParams}` : ''}`}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition-colors hover:border-brand-500/40 hover:text-fg"
        title="Filtrlangan jurnalni Excelga yuklab olish"
      >
        <Ico.files size={15} /> Excel
      </a>
    </div>
  );
}
