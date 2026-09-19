'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ExcelButton } from '@/ui';
import { useT } from '@/lib/i18n/client';
import { CourtManager, type CourtData, type CourtOverall } from './CourtManager';
import { ReturnsTab } from './ReturnsTab';
import { SendSuitsTab } from './SendSuitsTab';

// /sud — 3 KATTA TAB (2026-09-19, operator qarori).
//
// Ilgari /sud bitta uzun sahifa edi: 5 ta stat karta, brauzer navbati, Go paneli, pauza,
// «Tugallanmagan ishlar», firma qatorlari — va bitta checkbox qoralamani QAYTARIB BO'LMAYDIGAN
// real yuborishga aylantirardi. Qaytganlar esa alohida sahifada, faqat o'qish uchun edi.
// Endi oqim 3 ta aniq qadamga bo'lingan, har biri o'z tabida:
//   1) «Qaytganlar»         — sud qaytargan ishlar → sababini ko'rish, tuzatish, qayta qoralama;
//   2) «Qoralama (1 qadam)» — Tayyor → ADOLAT «Murojaatlarim»da qoralama (sudga YUBORMAYDI);
//   3) «Sudga o'tkazish»    — saqlangan qoralamani firma E-IMZO tasdig'i bilan sudga yuborish.
// Real yuborish FAQAT 3-tabda. Tepada — butun oqimni bir qatorda tushuntiruvchi 5 bosqich.
//
// URL: /sud?tab=qaytgan|qoralama|sud&firm=&s= (deep link). Tab almashganda URL
// `history.replaceState` bilan yangilanadi — Next 14.2 buni useSearchParams bilan sinxron qiladi
// (sidebar faol holati ham), lekin router.replace'dan farqli SERVERGA qayta so'rov YUBORMAYDI:
// har tab bosishda page.tsx courtReadiness'ni (og'ir) qayta hisoblamasin.

export type SudTabKey = 'qaytgan' | 'qoralama' | 'sud';
const TAB_ORDER: SudTabKey[] = ['qaytgan', 'qoralama', 'sud'];
const parseTab = (v: string | null | undefined): SudTabKey | null =>
  v === 'qaytgan' || v === 'qoralama' || v === 'sud' ? v : null;

type StageFirm = { firmId: number; firmName: string; total: number; stir?: string | null };

const n = (x: number) => x.toLocaleString('ru-RU');

// ── Tab meta (literal Tailwind sinflari — JIT interpolatsiyani ko'rmaydi) ─────────────────────
const TAB_META: Record<SudTabKey, { label: string; sub: string; badge: string; icon: React.JSX.Element }> = {
  qaytgan: {
    label: 'Qaytganlar',
    sub: 'Sud qaytargan — tuzatib qayta tayyorlash',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>,
  },
  qoralama: {
    label: 'Qoralama (1 qadam)',
    sub: 'Tayyor → ADOLAT «Murojaatlarim»da qoralama',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 18v-6M9 15h6" /></svg>,
  },
  sud: {
    label: 'Sudga o‘tkazish',
    sub: 'Qoralamani E-IMZO bilan sudga yuborish',
    badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
    icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg>,
  },
};

// ── 5 bosqichli oqim (tepadagi chiziq) ────────────────────────────────────────────────────────
type StepKey = 'notReady' | 'ready' | 'draft' | 'court' | 'returned';
const STEPS: { key: StepKey; label: string; hint: string; tab: SudTabKey | null; dot: string; value: string; ring: string }[] = [
  { key: 'notReady', label: 'Tayyor emas', hint: 'Hujjat yetishmaydi: talabnoma, skan, oferta, check yoki invoice raqami', tab: 'qoralama', dot: 'bg-rose-500', value: 'text-rose-600 dark:text-rose-400', ring: 'hover:border-rose-500/40' },
  { key: 'ready', label: 'Tayyor', hint: '5 hujjat to‘liq — qoralama qilishga tayyor', tab: 'qoralama', dot: 'bg-emerald-500', value: 'text-emerald-600 dark:text-emerald-400', ring: 'hover:border-emerald-500/40' },
  { key: 'draft', label: 'Qoralama (ADOLAT)', hint: '«Murojaatlarim»da saqlangan, sudga hali yuborilmagan', tab: 'sud', dot: 'bg-teal-500', value: 'text-teal-600 dark:text-teal-400', ring: 'hover:border-teal-500/40' },
  { key: 'court', label: 'Sudda', hint: 'Sudga topshirilgan (tizim yoki yurist yuborgan)', tab: null, dot: 'bg-indigo-500', value: 'text-indigo-600 dark:text-indigo-400', ring: '' },
  { key: 'returned', label: 'Qaytgan', hint: 'Sud qaytargan — tuzatib, qayta qoralama qilinadi', tab: 'qaytgan', dot: 'bg-amber-500', value: 'text-amber-600 dark:text-amber-400', ring: 'hover:border-amber-500/40' },
];

function NoAccess({ what }: { what: string }) {
  const t = useT();
  return (
    <div className="card grid place-items-center px-4 py-10 text-center">
      <div className="flex max-w-md flex-col items-center gap-2">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface-2 text-muted" aria-hidden>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </span>
        <div className="text-sm font-semibold">{t('Bu bo‘limga ruxsat yo‘q')}</div>
        <div className="text-xs text-muted">«{t(what)}» — {t('administrator sizga ruxsat bersa ochiladi.')}</div>
      </div>
    </div>
  );
}

// 2-tab: «nima qilinadi» + 3 qadamli mini stepper. Oxirgi qadam 3-tabga olib o'tadi.
function DraftExplainer({ onGoSend }: { onGoSend: () => void }) {
  const t = useT();
  const steps = [
    { title: 'Hujjatlar to‘liq', sub: '«Tayyor» — 5 shart bajarilgan' },
    { title: 'Go yoki «Qoralama tayyorlash»', sub: '24/7 avtomat yoki firma qatoridan qo‘lda' },
    { title: 'ADOLAT «Murojaatlarim»da qoralama', sub: 'Sudga hali YUBORILMAGAN' },
  ];
  return (
    <div className="rounded-2xl border border-teal-500/30 bg-teal-500/[0.04] p-4">
      <p className="max-w-4xl text-[13px] leading-relaxed text-fg/90">
        {t('Hujjatlari to‘liq («Tayyor») ishlar uchun tizim ADOLAT’da da’voni to‘liq to‘ldiradi, hujjatlarni biriktiradi va «Murojaatlarim»ga saqlaydi — sudga YUBORMAYDI. Buni «Go — 24/7» o‘zi qiladi yoki firma qatoridagi «Qoralama tayyorlash» bilan qo‘lda boshlaysiz. Tayyor qoralamalar keyin «Sudga o‘tkazish» tabidan firma kaliti (E-IMZO) bilan sudga yuboriladi.')}
      </p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]" aria-label={t('Qoralama qadamlari')}>
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal-500/15 text-[11px] font-bold text-teal-700 dark:text-teal-300" aria-hidden>{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold leading-tight">{t(s.title)}</span>
              <span className="block text-[11px] leading-snug text-muted">{t(s.sub)}</span>
            </span>
          </li>
        ))}
        <li className="flex">
          <button
            type="button"
            onClick={onGoSend}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-[12px] font-semibold text-indigo-700 outline-none transition-colors hover:bg-indigo-500/[0.18] focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:text-indigo-300"
          >
            {t('keyin «Sudga o‘tkazish» tabi')}
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </li>
      </ol>
    </div>
  );
}

export function SudTabs({ firms, selectedId, initialData, initialTab, initialFirmId, canSend, canReturns }: {
  firms: StageFirm[];
  selectedId?: number;
  /** Server-render qilingan court-ready (faqat sud:send bo'lsa) — CourtManager mount-fetch'siz chiziladi. */
  initialData: CourtData | null;
  initialTab: SudTabKey;
  initialFirmId: number | null;
  /** sud:send — 2-tab (qoralama) va 3-tab (sudga o'tkazish). */
  canSend: boolean;
  /** sud:returns — 1-tab (qaytganlar). */
  canReturns: boolean;
}) {
  const t = useT();
  const sp = useSearchParams();

  // Firma — URL'dan (JONLI): 2-tabdagi CourtManager ham, 3-tabdagi SendSuitsTab ham ?firm= ni
  // yangilaydi, shuning uchun manba URL (server tekshirgan initialFirmId faqat CourtManager'ning
  // boshlang'ich holati — SSR ma'lumoti aynan shu firma bo'yicha hisoblangan).
  const firmParsed = Number(sp?.get('firm') ?? NaN);
  const firmId = Number.isInteger(firmParsed) && firmParsed > 0 ? firmParsed : null;

  // Tab — mahalliy holat + URL bilan sinxron. Sidebar'dagi «Qaytganlar» (yoki «Sudga yuborish»)
  // havolasi shu sahifada bosilsa, komponent qayta yaratilmaydi — faqat URL o'zgaradi; shunda
  // ham to'g'ri tab ochilsin.
  const defaultTab: SudTabKey = canSend ? 'qoralama' : 'qaytgan';
  const urlTab = parseTab(sp?.get('tab')) ?? defaultTab;
  const [tab, setTab] = useState<SudTabKey>(initialTab);
  // Ochilgan tablar mount bo'lib QOLADI (yashiriladi, o'chirilmaydi): 2-tabdagi ketayotgan partiya
  // kuzatuvi, navbat va tanlovlar tab almashganda yo'qolmasin. Ochilmaganlari umuman yuklanmaydi.
  const [visited, setVisited] = useState<Set<SudTabKey>>(() => new Set([initialTab]));
  const markVisited = (k: SudTabKey) => setVisited((v) => (v.has(k) ? v : new Set(v).add(k)));
  useEffect(() => {
    if (urlTab !== tab) { setTab(urlTab); markVisited(urlTab); }
  }, [urlTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const writeUrl = useCallback((patch: Record<string, string | null>) => {
    try {
      const u = new URL(window.location.href);
      for (const [k, v] of Object.entries(patch)) { if (v == null) u.searchParams.delete(k); else u.searchParams.set(k, v); }
      window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
    } catch { /* URL yangilanmasa ham tab ishlaydi */ }
  }, []);

  const select = useCallback((k: SudTabKey) => {
    setTab(k);
    markVisited(k);
    writeUrl({ tab: k });
  }, [writeUrl]);

  const onFirmChange = useCallback((id: number | null) => { writeUrl({ firm: id ? String(id) : null }); }, [writeUrl]);

  // ── 5 bosqich sonlari ────────────────────────────────────────────────────────────────────────
  // Tayyor emas / Tayyor / Qoralama / Sudda — court-ready `overall` (SSR, keyin CourtManager har
  // yuklaganda onData orqali yangilanadi). Qaytgan — /konveyer/sud-returns counts.total; 3-tab
  // nishoni — /konveyer/sud-send counts.eligible. Ikkalasi KECHIKTIRIB (sahifa chizilgach) va
  // firma/snapshot o'zgarganda, keyin daqiqada bir (yashirin oynada emas) o'qiladi.
  const [overall, setOverall] = useState<CourtOverall | null>(initialData?.readiness.overall ?? null);
  const onData = useCallback((d: CourtData) => setOverall(d.readiness.overall), []);
  const [returnedCount, setReturnedCount] = useState<number | null>(null);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const countsReq = useRef(0);
  const loadCounts = useCallback(() => {
    const my = ++countsReq.current;
    const qs = new URLSearchParams();
    if (firmId) qs.set('firmId', String(firmId));
    if (selectedId) qs.set('s', String(selectedId));
    // Sessiya tugagan bo'lsa login HTML keladi — json() yiqiladi, son «—» bo'lib qoladi (jim).
    const getCount = (url: string, pick: (d: any) => unknown, set: (v: number | null) => void) =>
      fetch(url, { cache: 'no-store' })
        .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('application/json') ? r.json() : null))
        .then((d) => { if (my !== countsReq.current) return; const v = d ? pick(d) : null; set(typeof v === 'number' ? v : null); })
        .catch(() => { /* son ixtiyoriy — xato bo'lsa ko'rsatilmaydi */ });
    if (canReturns) void getCount(`/konveyer/sud-returns?${qs.toString()}`, (d) => d?.counts?.total, setReturnedCount);
    if (canSend) void getCount(`/konveyer/sud-send?${qs.toString()}`, (d) => d?.counts?.eligible, setEligibleCount);
  }, [firmId, selectedId, canReturns, canSend]);
  useEffect(() => {
    const first = setTimeout(loadCounts, 400);
    const iv = setInterval(() => { if (!document.hidden) loadCounts(); }, 60_000);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, [loadCounts]);

  const stepCount = (k: StepKey): number | null => {
    if (k === 'returned') return returnedCount;
    if (!overall) return null;
    if (k === 'ready') return overall.sendable;
    if (k === 'draft') return overall.draftReady;
    if (k === 'court') return overall.submitted;
    // «Tayyor emas» = qolgan hammasi (navbatdagilar — qoralamasi tayyorlanayotganlar — ham chiqariladi).
    return Math.max(0, overall.total - overall.sendable - overall.draftReady - overall.submitted - overall.queued);
  };
  const tabCount: Record<SudTabKey, number | null> = {
    qaytgan: canReturns ? returnedCount : null,
    qoralama: canSend && overall ? overall.sendable : null,
    sud: canSend ? eligibleCount : null,
  };
  const tabAllowed: Record<SudTabKey, boolean> = { qaytgan: canReturns, qoralama: canSend, sud: canSend };

  // ── Klaviatura: ←/→ (aylanma), Home/End — WAI-ARIA tabs (avtomatik faollashtirish) ─────────
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: React.KeyboardEvent, idx: number) => {
    const last = TAB_ORDER.length - 1;
    const next = e.key === 'ArrowRight' ? (idx === last ? 0 : idx + 1)
      : e.key === 'ArrowLeft' ? (idx === 0 ? last : idx - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    select(TAB_ORDER[next]);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="space-y-4">
      {/* Sarlavha */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t('Sud (adolat)')}</h1>
          <p className="mt-0.5 text-[12px] text-muted">{t('Tayyor ishdan sudgacha: qoralama → E-IMZO bilan sudga o‘tkazish → qaytganlarni qayta tayyorlash')}</p>
        </div>
        {/* Sud roʻyxati (excluded=1) boʻyicha portfel-analitik forma (форма_суд) — tanlangan snapshot + til. */}
        {/* /sud/forma — sud:send talab qiladi; faqat qaytganlar huquqi bo'lsa tugma ko'rinmaydi. */}
        {canSend && <ExcelButton href="/sud/forma" label="Sud formasi (Excel)" />}
      </div>

      {/* 5 BOSQICH — butun oqim bir qatorda: har bosqich bir jumla + son. Bosilsa tegishli tab ochiladi. */}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label={t('Sud oqimi — 5 bosqich')}>
        {STEPS.map((s, i) => {
          const cnt = stepCount(s.key);
          const target = s.tab && tabAllowed[s.tab] ? s.tab : null;
          const body = (
            <>
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{i + 1}</span>
                <span className="truncate text-[12px] font-semibold">{t(s.label)}</span>
              </span>
              <span className={`mt-1 block text-2xl font-bold leading-none tabular-nums ${s.value}`}>{cnt == null ? '—' : n(cnt)}</span>
              <span className="mt-1 block text-[11px] leading-snug text-muted">{t(s.hint)}</span>
              {s.key === 'ready' && overall && overall.queued > 0 && (
                <span className="mt-1 block text-[10px] font-medium text-amber-700 dark:text-amber-300">+{n(overall.queued)} {t('navbatda (tayyorlanmoqda)')}</span>
              )}
            </>
          );
          return (
            <li key={s.key} className="relative">
              {target ? (
                <button type="button" onClick={() => select(target)}
                  title={`${t(TAB_META[target].label)} ${t('tabini ochish')}`}
                  className={`block h-full w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/30 ${s.ring}`}>
                  {body}
                </button>
              ) : (
                <div className="h-full rounded-xl border border-line bg-surface px-3 py-2.5">{body}</div>
              )}
              {/* Bosqichlar orasidagi strelka — faqat bitta qatorda turganda (lg). */}
              {i < STEPS.length - 1 && (
                <span className="pointer-events-none absolute -right-[11px] top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-muted lg:grid" aria-hidden>
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* TABLAR */}
      <div role="tablist" aria-label={t('Sud bo‘limlari')} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface-2/60 p-1 sm:flex-row">
        {TAB_ORDER.map((k, idx) => {
          const m = TAB_META[k];
          const on = tab === k;
          const cnt = tabCount[k];
          return (
            <button
              key={k}
              ref={(el) => { tabRefs.current[idx] = el; }}
              id={`sud-tab-${k}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`sud-panel-${k}`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(k)}
              onKeyDown={(e) => onTabKey(e, idx)}
              className={`group flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                on ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:bg-surface/60 hover:text-fg'
              }`}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${on ? 'bg-brand-500/12 text-brand-600 dark:text-brand-400' : 'bg-surface text-muted'}`}>{m.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold tabular-nums text-muted">{idx + 1}</span>
                  <span className={`truncate text-sm ${on ? 'font-semibold' : 'font-medium'}`}>{t(m.label)}</span>
                  {!tabAllowed[k] && (
                    <svg className="h-3 w-3 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-label={t('Ruxsat berilmagan')}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  )}
                </span>
                <span className="block truncate text-[11px] text-muted">{t(m.sub)}</span>
              </span>
              {cnt != null && cnt > 0 && (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${m.badge}`}>{n(cnt)}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* PANELLAR — hammasi DOIM bor (aria-controls nishoni), lekin mazmuni faqat ochilgan bo'lsa. */}
      {TAB_ORDER.map((k) => (
        <div key={k} id={`sud-panel-${k}`} role="tabpanel" aria-labelledby={`sud-tab-${k}`} hidden={tab !== k} className="space-y-3">
          {!visited.has(k) ? null
            : k === 'qaytgan' ? (
              canReturns
                // Qayta qoralama = ADOLAT'da suit yaratish (sud:send sohasi) → tahrir faqat ikkalasi bo'lsa.
                ? <ReturnsTab snapshotId={selectedId} firmId={firmId ?? undefined} canEdit={canSend} active={tab === k} />
                : <NoAccess what="Qaytganlar" />
            ) : k === 'qoralama' ? (
              canSend ? (
                <>
                  <DraftExplainer onGoSend={() => select('sud')} />
                  <CourtManager
                    firms={firms}
                    selectedId={selectedId}
                    initialData={initialData}
                    initialFirmId={firmId}
                    onFirmChange={onFirmChange}
                    onData={onData}
                    active={tab === k}
                  />
                </>
              ) : <NoAccess what="Qoralama (1 qadam)" />
            ) : (
              canSend
                ? <SendSuitsTab snapshotId={selectedId} firmId={firmId ?? undefined} firms={firms} active={tab === k} />
                : <NoAccess what="Sudga o‘tkazish" />
            )}
        </div>
      ))}
    </div>
  );
}

export default SudTabs;
