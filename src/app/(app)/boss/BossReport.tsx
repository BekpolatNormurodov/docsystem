'use client';

// Boshliq (director) hisoboti — Firma × bosqich matritsasi. Har qatorda bitta firma; ustunlarda
// 4 bosqich: Talabnoma · Sanoat palatasi · Sudga chiqarilgan (4 ADOLAT statusi) · MIBga. Pastda JAMI.
// Snapshot filtri — sidebardagi umumiy sana (konv_s). Excel — /boss/excel.
import React, { useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ico, ExcelButton, Skeleton } from '@/ui';
import { SnapshotRefreshContext } from '@/ui/AppShell';
import { useT } from '@/lib/i18n/client';
import { ClientStatusSearch } from '../_components/ClientStatusSearch';
import type { BossReportData, BossFirmRow, BossTotals } from '@/lib/boss-report';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const som = (x: number) => (x || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const cellNum = (x: number, cls?: string) => <td className={cx('px-3 py-2.5 text-right tabular-nums', cls)}>{x > 0 ? n(x) : <span className="text-muted/50">·</span>}</td>;

export function BossReport({ data, snapLabel, linkDate, statusExcelHref, generatedAt }: { data: BossReportData; snapLabel: string | null; linkDate: string; statusExcelHref: string; generatedAt: string; todayLabel?: string }) {
  const t = useT();
  const { pending } = useContext(SnapshotRefreshContext); // snapshot almashtirilyapti — shimmer ko'rsatiladi
  const { firms, totals, regions, judges } = data;
  const [regOpen, setRegOpen] = useState(false); // default YOPIQ — bosib ochiladi
  const [judOpen, setJudOpen] = useState(false);
  const rtot = regions.reduce((a, r) => ({ clients: a.clients + r.clients, talabnoma: a.talabnoma + r.talabnoma, mib: a.mib + r.mib, sudTotal: a.sudTotal + r.sudTotal, granted: a.granted + r.granted, returned: a.returned + r.returned, debt: a.debt + r.debt }), { clients: 0, talabnoma: 0, mib: 0, sudTotal: 0, granted: 0, returned: 0, debt: 0 });

  return (
    <div className="space-y-5">
      <HisobotAutoRefresh generatedAt={generatedAt} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{t('Hisobot')}</h1>
            {snapLabel && <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400 tabular-nums">{snapLabel}</span>}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t('Firmalar bo‘yicha oqim: Talabnoma → Sanoat palatasi → Sudga chiqarilgan (holatlar bilan) → MIBga.')}
            {snapLabel ? <> {t('Snapshot')}: <b className="text-fg tabular-nums">{snapLabel}</b> ({t('sanani yuqoridan almashtiring')}).</> : ` ${t('Snapshot topilmadi.')}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {linkDate && <ClientStatusSearch linkDate={linkDate} />}
          {/* Tugma yorlig'i — TOZA (sanasiz). Sana faqat yuklab olingan fayl NOMIDA — dizayn qulayligi
              uchun (tugma qisqaroq, foydalanuvchi to'g'ridan-to'g'ri o'qiydi). */}
          <ExcelButton href={statusExcelHref} label={t('Mijozlar')} title={t('Mijozlar holati (firma · bosqich) — Excel')} />
          <ExcelButton href="/boss/excel" label={t('Matritsa')} title={t('Firma × bosqich matritsasi — Excel')} />
          <ExcelButton href="/sud/forma" label={t('Sud formasi')} title={t('Sud roʻyxati — toʻliq portfel-analitik forma (форма_суд)')} />
          <ExcelButton href="/boss/sudyalar-excel" label={t('Sudyalar')} title={t('Sudyalar hisoboti — qanoat/qaytar kesimi bilan (Excel)')} />
        </div>
      </header>

      {pending ? <BossShimmer /> : (<>
      {/* KPI: umumiy oqim. Jami qarz katta son (mlrd) — 2 ustun egallaydi, aks holda sig'maydi. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Kpi label={t('Mijozlar (kishi)')} value={n(totals.clients)} icon={<Ico.users size={18} />} tone="slate" />
        <Kpi label={t('Talabnoma (xat.hippo)')} value={n(totals.talabnoma)} icon={<Ico.send size={18} />} tone="indigo" />
        <Kpi label={t('Sanoat palatasi (skan)')} value={n(totals.sanoat)} icon={<Ico.stamp size={18} />} tone="violet" />
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
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">{t('Talabnoma (xat.hippo)')}</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom" title={t('Imzolangan skan biriktirilgan — sudga tayyor')}>{t('Sanoat palatasi (skan)')}</th>
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
            {t('Viloyat bo‘yicha — Talabnoma · Sud · MIB')}
          </span>
          <span className="text-xs text-muted">{regOpen ? t('Manzil portfeldan · tumanlar viloyatga yig‘ilgan') : `${n(regions.length)} ${t('ta viloyat · ochish')}`}</span>
        </button>
        {regOpen && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left">{t('Viloyat')}</th>
                <th className="border-l border-line px-3 py-2 text-right">{t('Mijozlar')}</th>
                <th className="border-l border-line px-3 py-2 text-right text-indigo-600 dark:text-indigo-300">{t('Talabnoma (xat.hippo)')}</th>
                <th className="border-l border-line px-3 py-2 text-right">{t('Sudga (jami)')}</th>
                <th className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-300">{t('Qanoatlantirilgan')}</th>
                <th className="px-3 py-2 text-right text-amber-600 dark:text-amber-300">{t('Qaytarilgan')}</th>
                <th className="border-l border-line px-3 py-2 text-right text-teal-600 dark:text-teal-300">{t('MIBga')}</th>
                <th className="border-l border-line px-3 py-2 text-right">{t('Jami qarz')}</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => (
                <tr key={r.region} className="border-b border-line/60 transition-colors hover:bg-surface-2">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 font-medium">{t(r.region)}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums font-medium">{r.clients > 0 ? n(r.clients) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-indigo-600 dark:text-indigo-300">{r.talabnoma > 0 ? n(r.talabnoma) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{r.sudTotal > 0 ? n(r.sudTotal) : <span className="text-muted/50">·</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{r.granted > 0 ? n(r.granted) : <span className="text-muted/50">·</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{r.returned > 0 ? n(r.returned) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-teal-600 dark:text-teal-300">{r.mib > 0 ? n(r.mib) : <span className="text-muted/50">·</span>}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{r.debt > 0 ? som(r.debt) : <span className="text-muted/50">·</span>}</td>
                </tr>
              ))}
              {regions.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">{t('Region maʼlumoti yoʻq.')}</td></tr>}
            </tbody>
            {regions.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-2/50 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface-2/50 px-3 py-2.5">{t('JAMI')}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{n(rtot.clients)}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-indigo-600 dark:text-indigo-300">{n(rtot.talabnoma)}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{n(rtot.sudTotal)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{n(rtot.granted)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{n(rtot.returned)}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-teal-600 dark:text-teal-300">{n(rtot.mib)}</td>
                  <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{som(rtot.debt)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        )}
      </div>

      {/* Sudya kesimi — cabinet.sud.uz detail'idan olingan `judge` maydonidan. Coverage rozetkasi
          bilan (aksariyat ishlarda hali detail sinxron qilinmagan → sudya bo'sh). */}
      <div className="card overflow-hidden">
        <button type="button" onClick={() => setJudOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left hover:bg-surface-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <svg className={cx('h-4 w-4 shrink-0 text-muted transition-transform', judOpen && 'rotate-90')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
            {t('Sudya boʻyicha')}
            <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:text-brand-300">{n(judges.rows.length)} {t('sudya')}</span>
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted tabular-nums">{n(judges.withJudge)}/{n(judges.submittedTotal)}</span>
          </div>
          <span className="text-xs text-muted">
            {judOpen ? t('Har 20 daqiqada avtomatik yangilanadi') : t('Ochish')}
          </span>
        </button>
        {judOpen && (
        <>
        <JudgeSyncPanel judges={judges} />
        <JudgeTable rows={judges.rows} />
        </>
        )}
      </div>
      </>)}
    </div>
  );
}

// «Sudyalar hisoboti» jadvali — saralanadigan (ustun sarlavhasiga bosib), reyting raqamli,
// vizual «% qanoat» chizig'i va pastda JAMI qatori bilan. Boshliq bir qarashda qaysi sudya
// arizalarni ko'proq qanoatlantiradi / qaytaradi ni ko'radi.
type JudgeSortKey = 'totalCases' | 'clients' | 'granted' | 'returned' | 'inProcess' | 'fulfilmentPct';
function JudgeTable({ rows }: { rows: BossReportData['judges']['rows'] }) {
  const t = useT();
  const [sortKey, setSortKey] = useState<JudgeSortKey>('totalCases');
  const [asc, setAsc] = useState(false);
  const [limit, setLimit] = useState(15);

  const sorted = React.useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      // «% qanoat» faqat hal qilingan ishlari bor sudyalar uchun ma'noli — 0/0 larni pastga.
      if (sortKey === 'fulfilmentPct') {
        const ad = a.granted + a.returned, bd = b.granted + b.returned;
        if (ad === 0 && bd === 0) return b.totalCases - a.totalCases;
        if (ad === 0) return 1;
        if (bd === 0) return -1;
      }
      const d = (b[sortKey] as number) - (a[sortKey] as number);
      return asc ? -d : d;
    });
    return arr;
  }, [rows, sortKey, asc]);

  const shown = sorted.slice(0, limit);
  const tot = React.useMemo(() => rows.reduce((s, r) => ({
    clients: s.clients + r.clients, totalCases: s.totalCases + r.totalCases,
    granted: s.granted + r.granted, returned: s.returned + r.returned, inProcess: s.inProcess + r.inProcess,
  }), { clients: 0, totalCases: 0, granted: 0, returned: 0, inProcess: 0 }), [rows]);
  const totDecided = tot.granted + tot.returned;
  const totPct = totDecided > 0 ? Math.round((tot.granted / totDecided) * 100) : 0;

  const th = (key: JudgeSortKey, label: string, tone?: string) => (
    <th className={cx('cursor-pointer select-none px-3 py-2 text-right transition-colors hover:text-fg', tone)}
      onClick={() => { if (sortKey === key) setAsc((v) => !v); else { setSortKey(key); setAsc(false); } }}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        <span className={cx('text-[8px] transition-opacity', sortKey === key ? 'opacity-100' : 'opacity-25')}>{sortKey === key && asc ? '▲' : '▼'}</span>
      </span>
    </th>
  );

  // Direktor uchun «insight» — kamida 5 ta hal qilingan ishi bor sudyalardan eng yaxshi/eng past
  // qanoat foizi + eng ko'p qaytaradigan. Kam ma'lumotli sudyalar (1-2 ish) reytingni buzmasin.
  const insight = React.useMemo(() => {
    const decided = rows.filter((r) => (r.granted + r.returned) >= 5);
    const best = decided.length ? [...decided].sort((a, b) => b.fulfilmentPct - a.fulfilmentPct)[0] : null;
    const worst = decided.length ? [...decided].sort((a, b) => a.fulfilmentPct - b.fulfilmentPct)[0] : null;
    const mostReturns = rows.length ? [...rows].sort((a, b) => b.returned - a.returned)[0] : null;
    return { best, worst, mostReturns };
  }, [rows]);
  const shortName = (full: string) => { const p = full.trim().split(/\s+/); return p.length >= 2 ? `${p[0]} ${p[1]}` : full; };

  if (rows.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted">
        {t('Hali sudya aniqlangan ish yo‘q. «Ulanishlar» dan cabinet.sud.uz ga ulanib detail sinxronlang.')}
      </div>
    );
  }

  return (
    <div>
      {/* Insight — 3 ta kartochka: eng ko'p qanoatlantiradigan · eng past · eng ko'p qaytaradigan */}
      {(insight.best || insight.mostReturns) && (
        <div className="grid grid-cols-1 gap-3 border-b border-line px-4 py-3 sm:grid-cols-3">
          {insight.best && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{t('Eng ko‘p qanoatlantiradi')}</div>
              <div className="mt-0.5 truncate text-sm font-semibold" title={insight.best.judge}>{shortName(insight.best.judge)}</div>
              <div className="text-xs text-muted">{insight.best.fulfilmentPct}% · {n(insight.best.granted)}/{n(insight.best.granted + insight.best.returned)} {t('hal qilingan')}</div>
            </div>
          )}
          {insight.worst && insight.worst.judge !== insight.best?.judge && (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">{t('Eng past qanoat')}</div>
              <div className="mt-0.5 truncate text-sm font-semibold" title={insight.worst.judge}>{shortName(insight.worst.judge)}</div>
              <div className="text-xs text-muted">{insight.worst.fulfilmentPct}% · {n(insight.worst.granted)}/{n(insight.worst.granted + insight.worst.returned)} {t('hal qilingan')}</div>
            </div>
          )}
          {insight.mostReturns && insight.mostReturns.returned > 0 && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{t('Eng ko‘p qaytaradi')}</div>
              <div className="mt-0.5 truncate text-sm font-semibold" title={insight.mostReturns.judge}>{shortName(insight.mostReturns.judge)}</div>
              <div className="text-xs text-muted">{n(insight.mostReturns.returned)} {t('qaytgan')} · {n(insight.mostReturns.totalCases)} {t('jami')}</div>
            </div>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[940px] text-sm">
        <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2 text-center">#</th>
            <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left">{t('Sudya')}</th>
            <th className="px-3 py-2 text-left">{t('Sud')}</th>
            <th className="px-3 py-2 text-left">{t('Firmalar')}</th>
            {th('clients', t('Kishi'))}
            {th('totalCases', t('Jami ish'))}
            {th('granted', t('Qanoat.'), 'text-emerald-600 dark:text-emerald-300')}
            {th('returned', t('Qaytar.'), 'text-amber-600 dark:text-amber-300')}
            {th('inProcess', t('Jarayonda'), 'text-sky-600 dark:text-sky-300')}
            {th('fulfilmentPct', t('% qanoat'))}
            <th className="px-3 py-2 text-left">{t('So‘nggi tinglash')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((r, i) => {
            const decided = r.granted + r.returned;
            return (
              <tr key={r.judge} className="hover:bg-surface-2/40">
                <td className="px-3 py-2 text-center text-xs font-semibold text-muted tabular-nums">{i + 1}</td>
                <td className="sticky left-0 bg-surface px-3 py-2 font-semibold">{r.judge}</td>
                <td className="px-3 py-2 text-xs text-muted">{r.courts.join(', ')}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.firms.map((f) => (<span key={f} className="badge border-line bg-surface-2 text-[10px]">{f}</span>))}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{n(r.clients)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{n(r.totalCases)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{r.granted > 0 ? n(r.granted) : <span className="text-muted/50">·</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-300">{r.returned > 0 ? n(r.returned) : <span className="text-muted/50">·</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums text-sky-600 dark:text-sky-300">{r.inProcess > 0 ? n(r.inProcess) : <span className="text-muted/50">·</span>}</td>
                <td className="px-3 py-2">
                  {decided > 0 ? <FulfilBar pct={r.fulfilmentPct} /> : <span className="block text-right text-muted/50">·</span>}
                </td>
                <td className="px-3 py-2 text-xs text-muted tabular-nums">{r.lastHearing ? new Date(r.lastHearing).toLocaleDateString('ru-RU') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line bg-surface-2/60 font-semibold">
            <td className="px-3 py-2.5" />
            <td className="sticky left-0 bg-surface-2/60 px-3 py-2.5">{t('JAMI')}</td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-right tabular-nums">{n(tot.clients)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums">{n(tot.totalCases)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{n(tot.granted)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{n(tot.returned)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-sky-600 dark:text-sky-300">{n(tot.inProcess)}</td>
            <td className="px-3 py-2.5">{totDecided > 0 ? <FulfilBar pct={totPct} /> : <span className="block text-right text-muted/50">·</span>}</td>
            <td className="px-3 py-2.5" />
          </tr>
        </tfoot>
      </table>
      {sorted.length > limit && (
        <div className="border-t border-line bg-surface-2/40 px-3 py-2 text-center">
          <button type="button" onClick={() => setLimit(sorted.length)}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">
            {t('Barchasini koʻrsatish')} ({sorted.length - limit} {t('ta yana')})
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

// «% qanoat» — vizual chiziq + son. Yashil ≥60, amber 30-60, qizil <30 (boshliq bir qarashda ajratadi).
function FulfilBar({ pct }: { pct: number }) {
  const tone = pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-rose-500';
  const txt = pct >= 60 ? 'text-emerald-600 dark:text-emerald-300' : pct >= 30 ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300';
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2">
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <span className={cx('w-9 text-right text-xs font-semibold tabular-nums', txt)}>{pct}%</span>
    </div>
  );
}

// «Sudya sinxron holati» — kesim tepasidagi boshqaruv paneli:
// coverage progress-bar + so'nggi/keyingi sinxron + JONLI holat (firma N/M, olingan K, o'tgan vaqt)
// + Boshlash / To'xtatish / Qayta boshlash tugmalari. Har so'rov cabinet'dan 8 s da bittadan
// olinadi (portalni bloklamaslik uchun) — shuning uchun fon rejimida ~5-6 soat davom etadi.
interface BoostState { running: boolean; startedAt: string | null; elapsedSec: number; progress: { firmsDone: number; firmsTotal: number; fetched: number } | null; }
function JudgeSyncPanel({ judges }: { judges: BossReportData['judges'] }) {
  const t = useT();
  const [busy, setBusy] = useState(false);            // tugma bosildi — javob kutilyapti
  const [err, setErr] = useState('');
  const [live, setLive] = useState<BoostState | null>(null);
  const coverage = judges.submittedTotal > 0 ? Math.min(100, Math.round((judges.withJudge / judges.submittedTotal) * 100)) : 0;
  const missing = Math.max(0, judges.submittedTotal - judges.withJudge);
  const lastAbs = judges.lastSyncAt ? fmtAbs(judges.lastSyncAt) : null;
  const running = live?.running ?? false;

  // Jonli holatni davriy so'rab turamiz: ishlaganda 8s, bo'sh turganda 30s.
  useEffect(() => {
    let dead = false;
    const poll = async () => {
      try {
        const r = await fetch('/api/cabinet/detail-sync-now', { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (!dead) setLive({ running: !!d.running, startedAt: d.startedAt ?? null, elapsedSec: d.elapsedSec ?? 0, progress: d.progress ?? null });
      } catch { /* tarmoq xatosi — keyingi urinishda */ }
    };
    poll();
    const id = setInterval(poll, live?.running ? 8_000 : 30_000);
    return () => { dead = true; clearInterval(id); };
  }, [live?.running]);

  async function call(action: 'start' | 'stop' | 'restart') {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/cabinet/detail-sync-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || String(r.status));
      // Darhol holatni yangilaymiz (poll'ni kutmasdan).
      const g = await fetch('/api/cabinet/detail-sync-now', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      if (g) setLive({ running: !!g.running, startedAt: g.startedAt ?? null, elapsedSec: g.elapsedSec ?? 0, progress: g.progress ?? null });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const elapsedLabel = (sec: number) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h} ${t('soat')} ${m} ${t('daq')}` : `${m} ${t('daq')}`;
  };

  return (
    <div className="border-b border-line bg-surface-2/40 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-muted">{t('Sudya aniqlangan')}:</span>
            <span className="font-semibold tabular-nums text-fg">{n(judges.withJudge)} / {n(judges.submittedTotal)}</span>
            <span className="tabular-nums text-brand-600 dark:text-brand-300">({coverage}%)</span>
            <span className="text-muted">·</span>
            <span className="text-muted">{t('Sudyasi olinmagan')}:</span>
            <span className="font-semibold tabular-nums text-fg">{n(missing)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${coverage}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            {lastAbs && <span>{t('Soʻnggi sinxron')}: <b className="tabular-nums text-fg">{lastAbs}</b></span>}
            <span>{t('Har')} <b className="text-fg">{judges.syncIntervalMin}</b> {t('daqiqada firma boshiga')} <b className="text-fg">{judges.perFirmBatch}</b> {t('ta ish avtomatik olinadi')}</span>
          </div>
          {/* JONLI holat — kuchaytirilgan sinxron ishlaganda */}
          {running && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-brand-500/25 bg-brand-500/[0.06] px-2.5 py-1.5 text-[11px]">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-brand-500" aria-hidden />
              <span className="font-medium text-brand-700 dark:text-brand-300">{t('Kuchaytirilgan sinxron ketmoqda')}</span>
              {live?.progress && (
                <span className="tabular-nums text-muted">
                  · {t('firma')} {live.progress.firmsDone}/{live.progress.firmsTotal}
                  · {t('olingan')}: <b className="text-fg">{n(live.progress.fetched)}</b>
                </span>
              )}
              <span className="tabular-nums text-muted">· {elapsedLabel(live?.elapsedSec ?? 0)}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {!running ? (
            <button type="button" onClick={() => call('start')} disabled={busy}
              className="btn-primary shrink-0 whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-60"
              title={t('Bitta yo‘la 5 firma × 200 ta ish detali olinadi (cabinet rate-limit sabab ~5-6 soat)')}>
              {busy ? t('Boshlanmoqda…') : t('Kuchaytirilgan sinxron')}
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => call('stop')} disabled={busy}
                className="btn-ghost shrink-0 whitespace-nowrap px-2.5 py-1.5 text-xs text-rose-600 disabled:opacity-60 dark:text-rose-300"
                title={t('Keyingi firma oldidan to‘xtaydi')}>
                {t('To‘xtatish')}
              </button>
              <button type="button" onClick={() => call('restart')} disabled={busy}
                className="btn-ghost shrink-0 whitespace-nowrap px-2.5 py-1.5 text-xs disabled:opacity-60"
                title={t('Turib qolgan bo‘lsa — qulfni tozalab yangidan boshlaydi')}>
                {t('Qayta boshlash')}
              </button>
            </div>
          )}
          {err && <span className="text-[10px] text-rose-600 dark:text-rose-300">{err}</span>}
        </div>
      </div>
    </div>
  );
}

// Tashkent vaqti bilan «kun.oy, soat:daqiqa».
const fmtAbs = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch { return ''; }
};

const HOUR_MS = 60 * 60 * 1000;

// «Yangilanish vaqti» — hisobot tepasida. Har 1 soatda AVTOMATIK yangilanadi (router.refresh →
// server bossReport'ni qayta hisoblaydi, shimmer bilan), qo'lda «Yangilash» tugmasi ham bor.
// Nisbiy vaqt («N daq oldin») FAQAT mount'dan keyin (hydration mismatch bo'lmasin — avval HH:MM).
function HisobotAutoRefresh({ generatedAt }: { generatedAt: string }) {
  const t = useT();
  const router = useRouter();
  const { pending, run } = useContext(SnapshotRefreshContext);
  const [now, setNow] = useState<number | null>(null);

  // Nisbiy yorliqni har daqiqada yangilab turamiz.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Har 1 soatda avtomatik yangilash. generatedAt o'zgarganda (yangilangach) timer qayta boshlanadi,
  // shunda tab ochiq turганда aniq soatlik interval saqlanadi.
  useEffect(() => {
    const id = setInterval(() => { run(() => router.refresh()); }, HOUR_MS);
    return () => clearInterval(id);
  }, [generatedAt, router, run]);

  const abs = fmtAbs(generatedAt);
  let rel = '';
  if (now != null) {
    const m = Math.max(0, Math.round((now - new Date(generatedAt).getTime()) / 60_000));
    rel = m < 1 ? t('hozirgina')
      : m < 60 ? `${m} ${t('daq oldin')}`
      : `${Math.round(m / 60)} ${t('soat oldin')}`;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted">
        <svg className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
        <span>{t('Yangilanish vaqti')}:</span>
        <b className="tabular-nums text-fg">{abs}</b>
        {rel && <span className="text-xs text-muted">· {rel}</span>}
      </span>
      <span className="flex items-center gap-2">
        <span className="hidden text-xs text-muted sm:inline">{t('Har 1 soatda avtomatik yangilanadi')}</span>
        <button
          type="button"
          onClick={() => { if (!pending) run(() => router.refresh()); }}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
          title={t('Hozir yangilash')}
        >
          <svg className={cx('h-3.5 w-3.5', pending && 'animate-spin')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
          {pending ? t('Yangilanmoqda…') : t('Yangilash')}
        </button>
      </span>
    </div>
  );
}

// Snapshot almashtirilayotganda (router.refresh pending) — Hisobot tarkibi shakliga mos shimmer:
// KPI kartalari to'ri + matritsa + viloyat jadvali. Sarlavha (tugmalar) o'zgarmaydi, shunda joyida qoladi.
function BossShimmer() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className={cx('card flex items-center gap-3 p-3', i === 6 && 'sm:col-span-2')}>
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
      {[6, 3].map((rows, k) => (
        <div key={k} className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="divide-y divide-line">
            {Array.from({ length: rows }).map((_, r) => (
              <div key={r} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-28" />
                {Array.from({ length: 6 }).map((_, c) => <Skeleton key={c} className="h-4 flex-1" />)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
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
