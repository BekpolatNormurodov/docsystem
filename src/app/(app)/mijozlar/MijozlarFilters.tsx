'use client';

import { Fragment, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SearchNormal1, ArrowDown2 } from 'iconsax-react';
import { useT } from '@/lib/i18n/client';

const pretty = (d: string) => d.split('-').reverse().join('.');

// Oqim (flow) qadamlari — Boshliq hisobotidagi tartibda: Talabnoma → Sanoat palatasi (skan) →
// Sud → MIB. «Sanoat palatasi» = imzolangan skan (SIGNED_SCANNED) = sudga ketadigan asosiy pool.
// Har biri bosiladi → ro'yxat shu qadamga filtrlanadi (konveyerPersons).
const FLOW: { key: string; label: string; color: string }[] = [
  { key: 'TALABNOMA', label: 'Talabnoma', color: '#6366f1' },
  { key: 'SANOAT', label: 'Sanoat palatasi (skan)', color: '#8b5cf6' },
  { key: 'COURT', label: 'Sud', color: '#3b82f6' },
  { key: 'EXEC', label: 'MIB', color: '#14b8a6' },
];

interface StepCounts { total: number; phases: Record<string, number>; talabnoma: number; scanned: number; overdue: number }

export function MijozlarFilters({ dates, date, initialQ, step, overdue, counts }: { dates: string[]; date: string; initialQ: string; step: string; overdue: boolean; counts: StepCounts }) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [open, setOpen] = useState(false);
  const [dq, setDq] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();

  function go(nextDate: string, nextQ: string, nextStep: string = step, nextOverdue: boolean = overdue) {
    const p = new URLSearchParams();
    p.set('date', nextDate);
    if (nextQ.trim()) p.set('q', nextQ.trim());
    if (nextStep) p.set('step', nextStep);
    if (nextOverdue) p.set('overdue', '1');
    p.set('page', '1');
    return `/mijozlar?${p.toString()}`;
  }
  const nfmt = (n: number) => n.toLocaleString('ru-RU');

  // Real-time search — debounced, replace so typing doesn't flood history. Navigate only when the
  // typed value actually differs from what the URL already reflects (initialQ). Comparing against
  // initialQ — instead of a "skip first render" ref — is robust to the server re-render that follows
  // each navigation, which was leaving the last keystroke unsynced.
  useEffect(() => {
    if (q.trim() === initialQ.trim()) return;
    const t = setTimeout(() => startTransition(() => router.replace(go(date, q))), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, initialQ, date, step, overdue]);

  // Close the date dropdown on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = dates.filter((d) => pretty(d).includes(dq.trim()) || d.includes(dq.trim()));

  return (
    <div className="mb-4 space-y-3">
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative" ref={box}>
        <span className="field-label">{t('Sana')}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="field-input flex min-w-[170px] items-center justify-between gap-2"
        >
          <span className="font-medium">{date === 'all' ? t('Hamma sana') : pretty(date)}</span>
          <ArrowDown2 size={16} className={`text-muted transition ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute z-30 mt-1 w-full min-w-[210px] rounded-xl border border-line bg-surface p-1 shadow-2xl">
            <div className="relative p-1">
              <SearchNormal1 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={dq}
                onChange={(e) => setDq(e.target.value)}
                placeholder={t('Sana qidirish…')}
                className="field-input w-full py-1.5 pl-8 text-sm"
              />
            </div>
            <div className="max-h-64 overflow-auto">
              {'hamma sana'.includes(dq.trim().toLowerCase()) && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(go('all', q));
                  }}
                  className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-surface-2 ${
                    date === 'all' ? 'font-semibold text-brand-600' : ''
                  }`}
                >
                  {t('Hamma sana')}
                </button>
              )}
              {filtered.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(go(d, q));
                  }}
                  className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-surface-2 ${
                    d === date ? 'font-semibold text-brand-600' : ''
                  }`}
                >
                  {pretty(d)}
                </button>
              ))}
              {filtered.length === 0 && !'hamma sana'.includes(dq.trim().toLowerCase()) && (
                <div className="px-3 py-2 text-xs text-muted">{t('Topilmadi')}</div>
              )}
            </div>
          </div>
        )}
      </div>

      <label className="min-w-[240px] flex-1">
        <span className="field-label">{t('Qidiruv (PINFL, F.I.Sh, passport yoki shartnoma raqami)')}</span>
        <div className="relative">
          <SearchNormal1 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('masalan: 3210… yoki ABDULLAYEV')}
            className="field-input w-full pl-9 pr-9"
          />
          {pending && (
            <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          )}
          {!pending && q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label={t('Tozalash')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
            >
              ✕
            </button>
          )}
        </div>
      </label>
    </div>

    {/* Oqim (stepper): mijoz qayerga yetgani — Talabnoma → Sanoat palatasi (skan) → Sud → MIB.
        Har qadam bosiladi → ro'yxat shu qadamga filtrlanadi. «Barchasi» → to'liq portfel. */}
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="field-label mb-0 mr-0.5">{t('Oqim')}:</span>
      <button
        type="button"
        onClick={() => router.push(go(date, q, ''))}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
          step === '' ? 'border-brand-500/40 bg-brand-500/10 text-brand-600 dark:text-brand-400' : 'border-line text-muted hover:bg-surface-2'
        }`}
      >
        {t('Barchasi')}
        <span className="rounded bg-surface-2 px-1 text-[10px] font-semibold tabular-nums text-muted">{nfmt(counts.total)}</span>
      </button>
      {FLOW.map((s, i) => {
        const active = step === s.key;
        const c = s.key === 'TALABNOMA' ? counts.talabnoma : s.key === 'SANOAT' ? counts.scanned : (counts.phases[s.key] ?? 0);
        return (
          <Fragment key={s.key}>
            <span className="select-none text-muted/40" aria-hidden>→</span>
            <button
              type="button"
              onClick={() => router.push(go(date, q, s.key))}
              title={s.key === 'SANOAT' ? t('Imzolangan skan biriktirilgan — sudga tayyor') : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                active ? 'text-white shadow-sm' : 'border-line text-muted hover:bg-surface-2'
              }`}
              style={active ? { background: s.color, borderColor: s.color } : undefined}
            >
              <span className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold" style={{ background: active ? 'rgba(255,255,255,.25)' : `${s.color}22`, color: active ? '#fff' : s.color }} aria-hidden>{i + 1}</span>
              {t(s.label)}
              <span className={`rounded px-1 text-[10px] font-semibold tabular-nums ${active ? 'bg-white/25' : 'bg-surface-2 text-muted'}`}>{nfmt(c)}</span>
            </button>
          </Fragment>
        );
      })}
      {/* «Osilib qolgan» — muddati o'tgan; qadamdan mustaqil (birga ishlaydi). */}
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <button
        type="button"
        onClick={() => router.push(go(date, q, step, !overdue))}
        title={t('Muddati o‘tган (osilib qolган) ishlar')}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
          overdue ? 'border-rose-500 bg-rose-500 text-white shadow-sm' : 'border-rose-500/30 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300'
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${overdue ? 'bg-white' : 'bg-rose-500'}`} aria-hidden />
        {t('Osilib qolgan')}
        <span className={`rounded px-1 text-[10px] font-semibold tabular-nums ${overdue ? 'bg-white/25' : 'bg-rose-500/15 text-rose-600 dark:text-rose-300'}`}>{nfmt(counts.overdue)}</span>
      </button>
    </div>
    </div>
  );
}
