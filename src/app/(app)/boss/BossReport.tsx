'use client';

// Boshliq (director) hisoboti — Firma × bosqich matritsasi. Har qatorda bitta firma; ustunlarda
// 4 bosqich: Talabnoma · Sanoat palatasi · Sudga chiqarilgan (4 ADOLAT statusi) · MIBga. Pastda JAMI.
// Snapshot filtri — sidebardagi umumiy sana (konv_s). Excel — /boss/excel.
import React, { useState } from 'react';
import { Ico } from '@/ui';
import { useT } from '@/lib/i18n/client';
import { ClientStatusSearch } from '../_components/ClientStatusSearch';
import type { BossReportData, BossFirmRow, BossTotals } from '@/lib/boss-report';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const som = (x: number) => (x || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const cellNum = (x: number, cls?: string) => <td className={cx('px-3 py-2.5 text-right tabular-nums', cls)}>{x > 0 ? n(x) : <span className="text-muted/50">·</span>}</td>;

export function BossReport({ data, snapLabel, linkDate, statusExcelHref }: { data: BossReportData; snapLabel: string | null; linkDate: string; statusExcelHref: string }) {
  const t = useT();
  const { firms, totals, regions } = data;
  const [regOpen, setRegOpen] = useState(false); // default YOPIQ — bosib ochiladi
  const rtot = regions.reduce((a, r) => ({ clients: a.clients + r.clients, talabnoma: a.talabnoma + r.talabnoma, mib: a.mib + r.mib, sudTotal: a.sudTotal + r.sudTotal, granted: a.granted + r.granted, returned: a.returned + r.returned, debt: a.debt + r.debt }), { clients: 0, talabnoma: 0, mib: 0, sudTotal: 0, granted: 0, returned: 0, debt: 0 });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{t('Hisobot')}</h1>
            <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">{t('Faqat admin')}</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t('Firmalar bo‘yicha oqim: Talabnoma → Sanoat palatasi → Sudga chiqarilgan (holatlar bilan) → MIBga.')}
            {snapLabel ? <> {t('Snapshot')}: <b className="text-fg tabular-nums">{snapLabel}</b> ({t('sanani yuqoridan almashtiring')}).</> : ` ${t('Snapshot topilmadi.')}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {linkDate && <ClientStatusSearch linkDate={linkDate} />}
          <a className="btn-ghost shrink-0" href={statusExcelHref} title={t('Mijozlar holati (firma · bosqich) — Excel')}>
            <Ico.download size={16} /> {t('Mijozlar Excel')}
          </a>
          <a className="btn-ghost shrink-0" href="/boss/excel" title={t('Firma × bosqich matritsasi — Excel')}><Ico.download size={16} /> {t('Matritsa Excel')}</a>
        </div>
      </header>

      {/* KPI: umumiy oqim. Jami qarz katta son (mlrd) — 2 ustun egallaydi, aks holda sig'maydi. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Kpi label={t('Mijozlar (kishi)')} value={n(totals.clients)} icon={<Ico.users size={18} />} tone="slate" />
        <Kpi label={t('Talabnoma')} value={n(totals.talabnoma)} icon={<Ico.send size={18} />} tone="indigo" />
        <Kpi label={t('Sanoat palatasi')} value={n(totals.sanoat)} icon={<Ico.stamp size={18} />} tone="violet" />
        <Kpi label={t('Sudga chiqarilgan')} value={n(totals.sud.total)} icon={<Ico.judge size={18} />} tone="sky" />
        <Kpi label={t('— qanoatlantirilgan')} value={n(totals.sud.granted)} icon={<Ico.check size={18} />} tone="emerald" />
        <Kpi label={t('MIBga chiqarilgan')} value={n(totals.mib)} icon={<Ico.building size={18} />} tone="teal" />
        <Kpi label={t('Jami qarz (soʻm)')} value={som(totals.debt)} icon={<Ico.receipt size={18} />} tone="slate" wide />
      </div>

      {/* Firma × bosqich matritsasi */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">{t('Firmalar bo‘yicha')} ({n(firms.length)})</span>
          <span className="text-xs text-muted">{t('Sudga chiqarilgan ustuni — ADOLAT portalidagi holat bo‘yicha')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th rowSpan={2} className="sticky left-0 z-10 bg-surface px-3 py-2 text-left align-bottom">{t('Firma')}</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">{t('Mijozlar')}</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">{t('Talabnoma')}</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">{t('Sanoat palatasi')}</th>
                <th colSpan={5} className="border-l border-line px-3 py-1.5 text-center">{t('Sudga chiqarilgan')}</th>
                <th rowSpan={2} className="border-l border-line px-3 py-2 text-right align-bottom">{t('MIBga')}</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">{t('Jami qarz')}</th>
              </tr>
              <tr className="border-b border-line">
                <th className="border-l border-line px-3 py-1.5 text-right font-medium text-sky-600 dark:text-sky-300">{t('Ko‘rib chiqishda')}</th>
                <th className="px-3 py-1.5 text-right font-medium text-emerald-600 dark:text-emerald-300">{t('Qanoatlantirilgan')}</th>
                <th className="px-3 py-1.5 text-right font-medium text-amber-600 dark:text-amber-300">{t('Qaytarilgan')}</th>
                <th className="px-3 py-1.5 text-right font-medium text-rose-600 dark:text-rose-300">{t('Rad qilingan')}</th>
                <th className="px-3 py-1.5 text-right font-semibold">{t('Jami')}</th>
              </tr>
            </thead>
            <tbody>
              {firms.map((f) => <Row key={f.firmId} f={f} />)}
              {firms.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">{t('Bu snapshotда maʼlumot yoʻq.')}</td></tr>}
            </tbody>
            {firms.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-2/50 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface-2/50 px-3 py-2.5">{t('JAMI')}</td>
                  {cellNum(totals.clients)}
                  {cellNum(totals.talabnoma)}
                  {cellNum(totals.sanoat)}
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-sky-600 dark:text-sky-300">{n(totals.sud.inReview)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{n(totals.sud.granted)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{n(totals.sud.returned)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-rose-600 dark:text-rose-300">{n(totals.sud.rejected)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n(totals.sud.total)}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{n(totals.mib)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{som(totals.debt)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Viloyat kesimi — MIBga va Sud (portfel manzili bo‘yicha) — ochilib-yopiladigan */}
      <div className="card overflow-hidden">
        <button type="button" onClick={() => setRegOpen((v) => !v)}
          className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2/50">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <svg className={cx('h-4 w-4 shrink-0 text-muted transition-transform', regOpen && 'rotate-90')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
            {t('Viloyat bo‘yicha — MIBga va Sud')}
          </span>
          <span className="text-xs text-muted">{regOpen ? t('Manzil portfeldan · tumanlar viloyatga yig‘ilgan') : `${n(regions.length)} ${t('ta viloyat · ochish')}`}</span>
        </button>
        {regOpen && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left">{t('Viloyat')}</th>
                <th className="border-l border-line px-3 py-2 text-left">{t('Ijrochi')}</th>
                <th className="border-l border-line px-3 py-2 text-right">{t('Mijozlar')}</th>
                <th className="px-3 py-2 text-right text-indigo-600 dark:text-indigo-300">{t('Talabnoma')}</th>
                <th className="border-l border-line px-3 py-2 text-right">{t('MIBga')}</th>
                <th className="border-l border-line px-3 py-2 text-right">{t('Sudga (jami)')}</th>
                <th className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-300">{t('Qanoatlantirilgan')}</th>
                <th className="px-3 py-2 text-right text-amber-600 dark:text-amber-300">{t('Qaytarilgan')}</th>
                <th className="border-l border-line px-3 py-2 text-right">{t('Jami qarz')}</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => (
                <tr key={r.region} className="border-b border-line/60 transition-colors hover:bg-surface-2">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 font-medium">{t(r.region)}</td>
                  <td className="border-l border-line px-3 py-1.5"><ExecutorCell region={r.region} initial={r.executor} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">{r.clients > 0 ? n(r.clients) : <span className="text-muted/50">·</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-indigo-600 dark:text-indigo-300">{r.talabnoma > 0 ? n(r.talabnoma) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-teal-600 dark:text-teal-300">{r.mib > 0 ? n(r.mib) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{r.sudTotal > 0 ? n(r.sudTotal) : <span className="text-muted/50">·</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{r.granted > 0 ? n(r.granted) : <span className="text-muted/50">·</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{r.returned > 0 ? n(r.returned) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{r.debt > 0 ? som(r.debt) : <span className="text-muted/50">·</span>}</td>
                </tr>
              ))}
              {regions.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">{t('Region maʼlumoti yoʻq.')}</td></tr>}
            </tbody>
            {regions.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-2/50 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface-2/50 px-3 py-2.5">{t('JAMI')}</td>
                  <td className="border-l border-line px-3 py-2.5 text-muted/50">·</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n(rtot.clients)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-indigo-600 dark:text-indigo-300">{n(rtot.talabnoma)}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-teal-600 dark:text-teal-300">{n(rtot.mib)}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{n(rtot.sudTotal)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{n(rtot.granted)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{n(rtot.returned)}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{som(rtot.debt)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        )}
      </div>
    </div>
  );
}

function Row({ f }: { f: BossFirmRow }) {
  return (
    <tr className="border-b border-line/60 transition-colors hover:bg-surface-2">
      <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 font-medium">{f.firmName.replace(/ MIKROMOLIYA.*$/i, '')}</td>
      {cellNum(f.clients, 'font-medium')}
      {cellNum(f.talabnoma, 'text-indigo-600 dark:text-indigo-300')}
      {cellNum(f.sanoat, 'text-violet-600 dark:text-violet-300')}
      <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-sky-600 dark:text-sky-300">{f.sud.inReview > 0 ? n(f.sud.inReview) : <span className="text-muted/50">·</span>}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{f.sud.granted > 0 ? n(f.sud.granted) : <span className="text-muted/50">·</span>}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{f.sud.returned > 0 ? n(f.sud.returned) : <span className="text-muted/50">·</span>}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600 dark:text-rose-300">{f.sud.rejected > 0 ? n(f.sud.rejected) : <span className="text-muted/50">·</span>}</td>
      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{f.sud.total > 0 ? n(f.sud.total) : <span className="text-muted/50">·</span>}</td>
      <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-teal-600 dark:text-teal-300">{f.mib > 0 ? n(f.mib) : <span className="text-muted/50">·</span>}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{f.debt > 0 ? som(f.debt) : <span className="text-muted/50">·</span>}</td>
    </tr>
  );
}

// Region qatoridagi tahrirlanadigan «Ijrochi» katagi — nom yozib, fokusdan chiqilganda (yoki Enter)
// /boss/executor'ga saqlaydi (admin). Bo'sh qoldirilса biriktirma o'chiriladi.
function ExecutorCell({ region, initial }: { region: string; initial: string | null }) {
  const t = useT();
  const [value, setValue] = useState(initial ?? '');
  const savedRef = React.useRef(initial ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  async function save() {
    const v = value.trim();
    if (v === savedRef.current.trim()) return;
    setStatus('saving');
    try {
      const res = await fetch('/boss/executor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region, executorName: v }) });
      if (!res.ok) throw new Error('save failed');
      savedRef.current = v;
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1500);
    } catch { setStatus('error'); }
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        placeholder={t('Ijrochi biriktirilmagan')}
        title={t('Ism familiya')}
        className="w-40 rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
      />
      {status === 'saving' && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden />}
      {status === 'saved' && <span className="shrink-0 text-[11px] font-medium text-emerald-600 dark:text-emerald-300" title={t('Saqlandi')}>✓</span>}
      {status === 'error' && <span className="shrink-0 text-[11px] font-medium text-rose-600 dark:text-rose-300" title={t('Saqlanmadi')}>!</span>}
    </div>
  );
}

const TONES: Record<string, string> = {
  indigo: 'text-indigo-600 dark:text-indigo-300', violet: 'text-violet-600 dark:text-violet-300',
  sky: 'text-sky-600 dark:text-sky-300', emerald: 'text-emerald-600 dark:text-emerald-300',
  teal: 'text-teal-600 dark:text-teal-300', slate: 'text-fg',
};
function Kpi({ label, value, icon, tone, wide }: { label: string; value: string; icon: React.ReactNode; tone: string; wide?: boolean }) {
  return (
    <div className={cx('card flex items-center gap-3 p-3', wide && 'sm:col-span-2')}>
      <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2', TONES[tone])}>{icon}</span>
      <div className="min-w-0">
        {/* Katta summalar (mlrd) sig'sin: lg font + sindirmasdan qisqartirish (title'da to'liq son). */}
        <div className={cx('truncate font-semibold tabular-nums leading-tight', wide ? 'text-lg' : 'text-xl', TONES[tone])} title={value}>{value}</div>
        <div className="truncate text-xs text-muted">{label}</div>
      </div>
    </div>
  );
}
