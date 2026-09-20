// Firma-per-qator navbat jadvali. 2026-09-20 operator: «navbat = firma, ketmoqda = alohida».
// Har qatorda AYNAN bitta «N navbatda» chip (statik), ALOHIDA pulsing «ketmoqda M/N» chip
// (faqat shu firma hozir ishlayotgan bo'lsa) va bitta amal tugmasi. Chip qatorlari yig'ilmagan.
'use client';
import { useT } from '@/lib/i18n/client';
import type { Tone, HeaderAction } from './HeaderShell';

const CHIP: Record<Tone, string> = {
  slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-200', emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  indigo: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300', sky: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', rose: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  brand: 'bg-brand-500/15 text-brand-700 dark:text-brand-300',
};
const BTN: Record<Tone, string> = {
  slate: 'border-line text-fg hover:bg-surface-2', emerald: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/[0.18] dark:text-emerald-300',
  amber: 'border-amber-500/50 bg-amber-500/10 text-amber-700 hover:bg-amber-500/[0.18] dark:text-amber-300',
  teal: 'border-teal-500/50 bg-teal-500/10 text-teal-700 hover:bg-teal-500/[0.18] dark:text-teal-300',
  indigo: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/[0.18] dark:text-indigo-300',
  sky: 'border-sky-500/50 bg-sky-500/10 text-sky-700 hover:bg-sky-500/[0.18] dark:text-sky-300',
  violet: 'border-violet-500/50 bg-violet-500/10 text-violet-700 hover:bg-violet-500/[0.18] dark:text-violet-300',
  rose: 'border-rose-500/50 bg-rose-500/10 text-rose-700 hover:bg-rose-500/[0.18] dark:text-rose-300',
  brand: 'border-brand-500/50 bg-brand-500/10 text-brand-700 hover:bg-brand-500/[0.18] dark:text-brand-300',
};

export interface FirmRow {
  firmId: number;
  firmName: string;
  /** Chapdan o'ngga chip'lar — odatda 1-2 ta (statik holat, bitta so'z). */
  chips: { label: string; tone: Tone; hint?: string }[];
  /** Faqat shu firma hozir ishlayotgan bo'lsa — pulsing «ketmoqda» chip. */
  running?: { progress: number; total: number; kindLabel?: string } | null;
  /** Bitta amal tugmasi — yo'q bo'lsa muted matn ko'rsatiladi. */
  action?: HeaderAction | null;
  /** Amal o'rniga muted matn (masalan «Tayyor ish yo'q»). */
  emptyText?: string;
  /** Firma pauzasi (yopiq/muted qatorga aylantiradi). */
  paused?: boolean;
}

export function FirmQueue({ title, subtitle, rows, empty }: {
  title: string;
  subtitle?: string;
  rows: FirmRow[];
  empty?: string;
}) {
  const t = useT();
  const n = (x: number) => x.toLocaleString('ru-RU');
  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-line bg-surface p-3">
        <h3 className="text-[13px] font-semibold">{t(title)}</h3>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted">{t(subtitle)}</p>}
        <p className="mt-3 text-[12px] text-muted">{t(empty ?? 'Bo‘sh')}</p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold">{t(title)}</h3>
          {subtitle && <p className="text-[11px] text-muted">{t(subtitle)}</p>}
        </div>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.firmId} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-[12px] ${r.paused ? 'opacity-60' : ''}`}>
            <span className="w-full basis-full truncate font-medium sm:w-auto sm:basis-auto sm:min-w-0 sm:flex-1">{r.firmName}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {r.chips.map((c, i) => (
                <span key={i} className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${CHIP[c.tone]}`} title={c.hint ? t(c.hint) : undefined}>
                  {t(c.label)}
                </span>
              ))}
              {r.running && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300" title={r.running.kindLabel ? t(r.running.kindLabel) : t('Ayni damda ishlanmoqda')}>
                  <span className="relative flex h-1.5 w-1.5" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500/70" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
                  </span>
                  {t('ketmoqda')} <span className="tabular-nums">{n(r.running.progress)}/{n(r.running.total)}</span>
                </span>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center">
              {r.action ? (
                <button type="button" onClick={r.action.onClick} disabled={r.action.disabled} title={r.action.title}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50 ${BTN[r.action.tone ?? 'brand']}`}>
                  {t(r.action.label)}
                </button>
              ) : r.emptyText ? (
                <span className="text-[11px] text-muted">{t(r.emptyText)}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
