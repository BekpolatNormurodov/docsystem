'use client';

// Boshliq (director) hisoboti — Firma × bosqich matritsasi. Har qatorda bitta firma; ustunlarda
// 4 bosqich: Talabnoma · Sanoat palatasi · Sudga chiqarilgan (4 ADOLAT statusi) · MIBga. Pastda JAMI.
// Snapshot filtri — sidebardagi umumiy sana (konv_s). Excel — /boss/excel.
import React, { useState } from 'react';
import { Ico } from '@/ui';
import type { BossReportData, BossFirmRow, BossTotals } from '@/lib/boss-report';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const som = (x: number) => (x || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const cellNum = (x: number, cls?: string) => <td className={cx('px-3 py-2.5 text-right tabular-nums', cls)}>{x > 0 ? n(x) : <span className="text-muted/50">·</span>}</td>;

export function BossReport({ data, snapLabel }: { data: BossReportData; snapLabel: string | null }) {
  const { firms, totals, regions } = data;
  const [regOpen, setRegOpen] = useState(true);
  const rtot = regions.reduce((a, r) => ({ clients: a.clients + r.clients, mib: a.mib + r.mib, sudTotal: a.sudTotal + r.sudTotal, granted: a.granted + r.granted, returned: a.returned + r.returned, debt: a.debt + r.debt }), { clients: 0, mib: 0, sudTotal: 0, granted: 0, returned: 0, debt: 0 });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Hisobot</h1>
            <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">Faqat admin</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Firmalar bo‘yicha oqim: Talabnoma → Sanoat palatasi → Sudga chiqarilgan (holatlar bilan) → MIBga.
            {snapLabel ? <> Snapshot: <b className="text-fg tabular-nums">{snapLabel}</b> (sanani yuqoridan almashtiring).</> : ' Snapshot topilmadi.'}
          </p>
        </div>
        <a className="btn-ghost shrink-0" href="/boss/excel"><Ico.download size={16} /> Excel</a>
      </header>

      {/* KPI: umumiy oqim. Jami qarz katta son (mlrd) — 2 ustun egallaydi, aks holda sig'maydi. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Kpi label="Mijozlar (kishi)" value={n(totals.clients)} icon={<Ico.users size={18} />} tone="slate" />
        <Kpi label="Talabnoma" value={n(totals.talabnoma)} icon={<Ico.send size={18} />} tone="indigo" />
        <Kpi label="Sanoat palatasi" value={n(totals.sanoat)} icon={<Ico.stamp size={18} />} tone="violet" />
        <Kpi label="Sudga chiqarilgan" value={n(totals.sud.total)} icon={<Ico.judge size={18} />} tone="sky" />
        <Kpi label="— qanoatlantirilgan" value={n(totals.sud.granted)} icon={<Ico.check size={18} />} tone="emerald" />
        <Kpi label="MIBga chiqarilgan" value={n(totals.mib)} icon={<Ico.building size={18} />} tone="teal" />
        <Kpi label="Jami qarz (soʻm)" value={som(totals.debt)} icon={<Ico.receipt size={18} />} tone="slate" wide />
      </div>

      {/* Firma × bosqich matritsasi */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">Firmalar bo‘yicha ({n(firms.length)})</span>
          <span className="text-xs text-muted">Sudga chiqarilgan ustuni — ADOLAT portalidagi holat bo‘yicha</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th rowSpan={2} className="sticky left-0 z-10 bg-surface px-3 py-2 text-left align-bottom">Firma</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">Mijozlar</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">Talabnoma</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">Sanoat palatasi</th>
                <th colSpan={5} className="border-l border-line px-3 py-1.5 text-center">Sudga chiqarilgan</th>
                <th rowSpan={2} className="border-l border-line px-3 py-2 text-right align-bottom">MIBga</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">Jami qarz</th>
              </tr>
              <tr className="border-b border-line">
                <th className="border-l border-line px-3 py-1.5 text-right font-medium text-sky-600 dark:text-sky-300">Ko‘rib chiqishda</th>
                <th className="px-3 py-1.5 text-right font-medium text-emerald-600 dark:text-emerald-300">Qanoatlantirilgan</th>
                <th className="px-3 py-1.5 text-right font-medium text-amber-600 dark:text-amber-300">Qaytarilgan</th>
                <th className="px-3 py-1.5 text-right font-medium text-rose-600 dark:text-rose-300">Rad qilingan</th>
                <th className="px-3 py-1.5 text-right font-semibold">Jami</th>
              </tr>
            </thead>
            <tbody>
              {firms.map((f) => <Row key={f.firmId} f={f} />)}
              {firms.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted">Bu snapshotда maʼlumot yoʻq.</td></tr>}
            </tbody>
            {firms.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-2/50 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface-2/50 px-3 py-2.5">JAMI</td>
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
            Viloyat bo‘yicha — MIBga va Sud
          </span>
          <span className="text-xs text-muted">{regOpen ? 'Manzil portfeldan · tumanlar viloyatga yig‘ilgan' : `${n(regions.length)} ta viloyat · ochish`}</span>
        </button>
        {regOpen && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left">Viloyat</th>
                <th className="px-3 py-2 text-right">Mijozlar</th>
                <th className="border-l border-line px-3 py-2 text-right">MIBga</th>
                <th className="border-l border-line px-3 py-2 text-right">Sudga (jami)</th>
                <th className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-300">Qanoatlantirilgan</th>
                <th className="px-3 py-2 text-right text-amber-600 dark:text-amber-300">Qaytarilgan</th>
                <th className="border-l border-line px-3 py-2 text-right">Jami qarz</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => (
                <tr key={r.region} className="border-b border-line/60 transition-colors hover:bg-surface-2">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 font-medium">{r.region}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">{r.clients > 0 ? n(r.clients) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-teal-600 dark:text-teal-300">{r.mib > 0 ? n(r.mib) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{r.sudTotal > 0 ? n(r.sudTotal) : <span className="text-muted/50">·</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{r.granted > 0 ? n(r.granted) : <span className="text-muted/50">·</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{r.returned > 0 ? n(r.returned) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{r.debt > 0 ? som(r.debt) : <span className="text-muted/50">·</span>}</td>
                </tr>
              ))}
              {regions.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">Region maʼlumoti yoʻq.</td></tr>}
            </tbody>
            {regions.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-2/50 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface-2/50 px-3 py-2.5">JAMI</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n(rtot.clients)}</td>
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
