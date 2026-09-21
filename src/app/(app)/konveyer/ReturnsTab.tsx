'use client';

// /sud → «Qaytganlar» tab'i (2026-09-20 qayta dizayn: 3 tab bir xil qobiqda).
// Operator shikoyati: «bir xil son turli so'z bilan chalg'itardi». Endi vokabulyar bir xil:
// «Ketmoqda» (bitta strip HeaderShell.running ichida) · «Navbatda» (qayta qoralama navbati) ·
// «Sudda» (yuborilgan) · «To'siq» (blocker). Har firma qatorida yagona amal — «Qayta qoralama».
// Sudga BU YERDAN HECH NARSA yubormaydi: tayyorlangan ishlar «Sudga o'tkazish» tabiga o'tadi.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchesFuzzy } from '@/lib/fuzzy';
import { Ico, Modal, Skeleton, useConfirm } from '@/ui';
import { useT } from '@/lib/i18n/client';
import { CaseDocs } from './CaseDocs';
import { CabinetReturns } from './CabinetReturns';
import { HeaderShell } from './_shared/HeaderShell';
import { FirmQueue, type FirmRow } from './_shared/FirmQueue';

// ── types (mirror src/lib/court-returns-tab.ts — client prisma import qila olmaydi) ─────────────
type ReturnSub = 'waiting' | 'held' | 'queued' | 'failed' | 'redrafted';
type ReasonCode = 'tartibsiz' | 'varaq' | 'yetkazilmagan' | 'jshshir' | 'boshqa';
interface Flags { talabnoma: boolean; scan: boolean; oferta: boolean; receipt: boolean; boji: boolean }
interface Row {
  caseId: number; firmId: number; firmName: string; clientName: string | null; pinfl: string | null;
  courtName: string | null; declinedAt: string | null; declinedCaseId: string | null;
  portalResult: string | null; portalResultLabel: string | null; reasons: string[]; reasonCode: ReasonCode | null;
  sub: ReturnSub; queueError: string | null; ready: boolean; missing: string[]; totalDebt: number | null;
  stage: string; receiptNumber: string | null; talabnomaSent: boolean; flags: Flags | null; sendable: boolean;
  portalCaseNumber: string | null; portalStatus: string | null; reasonsAt: string | null; dupOpen: boolean;
  heldAt: string | null; redraftedAt: string | null;
}
interface Data {
  rows: Row[];
  counts: { total: number; bySub: Record<ReturnSub, number>; byReason: Record<string, number> };
  autoReset: boolean;
  snapshotId: number | null;
  activeJob: { id: number; firmId: number | null; kind: 'send' | 'draft' | 'real'; progress: number; total: number; fromReturns: boolean } | null;
}
interface ReasonsRes { fetched: number; failed: number; remaining: number; needAuth: string[]; stopped: string | null }
interface Ajrim { available: boolean; ajrimType: string | null; pdfName: string | null; judge: string | null; court: string | null; outgoingDate: string | null }

const PAGE = 60;
const n = (x: number) => x.toLocaleString('ru-RU');
const dmy = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const initials = (s: string | null) => (s || '—').trim().replace(/[«»"]/g, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—';
const eligible = (r: Row) => (r.sub === 'waiting' || r.sub === 'failed') && r.sendable && !r.dupOpen;

/** Sessiya tugaganda server login'ga yo'naltiradi (200 + HTML) — aniq xabar (CourtManager getJson bilan bir xil). */
async function getJson<T>(url: string, init: RequestInit | undefined, t: (s: string) => string): Promise<T> {
  const res = await fetch(url, init);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (res.redirected || res.url.includes('/login')) throw new Error(t('Sessiya tugagan — sahifani yangilab, qaytadan kiring.'));
    throw new Error(`${t('Server JSON qaytarmadi')} (${res.status}). ${t('Sahifani yangilab ko‘ring.')}`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string })?.error || `${t('Server xatosi')} (${res.status})`);
  return data as T;
}
const postJson = <T,>(url: string, body: unknown, t: (s: string) => string) =>
  getJson<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, t);

// Bir xil so'z bir xil ma'no: sub filter chip'lari va HeaderShell stats bir xil label.
// (2026-09-20 operator: «Kutmoqda» dagi son va stat sondagi son bir xil bo'lishi kerak.)
const SUB_META: Record<ReturnSub, { label: string; chip: string; active: string; dot: string; hint: string }> = {
  waiting: { label: 'Kutmoqda', chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', active: 'bg-amber-500 text-white shadow-sm', dot: 'bg-amber-500', hint: 'Hali qayta tayyorlanmagan — sababini ko‘rib, hujjatni tuzating.' },
  failed: { label: 'Xato', chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-300', active: 'bg-rose-500 text-white shadow-sm', dot: 'bg-rose-500', hint: 'Qayta qoralama urinishi o‘tmadi — xato matnini o‘qing.' },
  held: { label: 'Ushlangan', chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-300', active: 'bg-violet-500 text-white shadow-sm', dot: 'bg-violet-500', hint: 'Paket tuzatilguncha qayta qoralamaga olinmaydi (Go ham olmaydi).' },
  queued: { label: 'Navbatda', chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-300', active: 'bg-sky-500 text-white shadow-sm', dot: 'bg-sky-500', hint: 'Qayta qoralama partiyasida — ADOLAT’da tayyorlanmoqda.' },
  redrafted: { label: 'Tayyorlangan', chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', active: 'bg-emerald-500 text-white shadow-sm', dot: 'bg-emerald-500', hint: 'Yangi qoralama tayyor — «Sudga o‘tkazish» bo‘limida yuboriladi.' },
};
const SUB_ORDER: ReturnSub[] = ['waiting', 'failed', 'held', 'queued', 'redrafted'];
const REASON_META: Record<ReasonCode | 'none', { label: string; chip: string; active: string; hint: string }> = {
  tartibsiz: { label: 'Tartibsiz / teskari', chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-300', active: 'bg-rose-500 text-white shadow-sm', hint: 'Hujjatlar tartibsiz yoki teskari — paket tartibi 2026-09-18 da tuzatilgan; qayta qoralama yangi paket bilan ketadi.' },
  varaq: { label: 'Varaqlar to‘liq emas', chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', active: 'bg-amber-500 text-white shadow-sm', hint: 'Hujjat varaqlari to‘liq emas — skan va ofertalarni tekshiring.' },
  yetkazilmagan: { label: 'Yetkazilganlik isboti yo‘q', chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-300', active: 'bg-violet-500 text-white shadow-sm', hint: 'Qarzdor talabnomani olgani isbotlanmagan — yetkazilgan (to‘ldirilgan) check kerak.' },
  jshshir: { label: 'JShShIR ma’lumoti', chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-300', active: 'bg-sky-500 text-white shadow-sm', hint: 'Javobgar JShShIR (PINFL) ma’lumotlari to‘liq emas.' },
  boshqa: { label: 'Boshqa sabab', chip: 'bg-slate-500/10 text-slate-600 dark:text-slate-300', active: 'bg-slate-500 text-white shadow-sm', hint: 'Sabab matnini o‘qing.' },
  none: { label: 'Sabab olinmagan', chip: 'border border-dashed border-line text-muted', active: 'bg-slate-600 text-white shadow-sm', hint: '«Sabablarni yangilash» tugmasi ADOLAT’dan sababni olib keladi.' },
};
const REASON_ORDER: (ReasonCode | 'none')[] = ['tartibsiz', 'varaq', 'yetkazilmagan', 'jshshir', 'boshqa', 'none'];

const TILES: { key: keyof Flags; short: string; label: string }[] = [
  { key: 'talabnoma', short: 'T', label: 'Talabnoma' },
  { key: 'receipt', short: 'C', label: 'Check (kvitansiya)' },
  { key: 'scan', short: 'S', label: 'Skan (palata)' },
  { key: 'oferta', short: 'O', label: 'Oferta' },
  { key: 'boji', short: 'B', label: 'Boji (invoice raqami)' },
];

// ── kichik bo'laklar ─────────────────────────────────────────────────────────────────────
function ReadyTiles({ r }: { r: Row }) {
  const t = useT();
  if (!r.flags) return null;
  const noDelivery = r.missing.includes('delivery');
  return (
    <div className="flex items-center gap-1" aria-label={r.ready ? t('Hujjatlar to‘liq') : t('Hujjat yetishmaydi')}>
      {TILES.map((d) => {
        const ok = r.flags![d.key];
        const warn = !ok && d.key === 'receipt' && noDelivery;
        const tip = warn ? t('Check bor, lekin yetkazilganlik isboti yo‘q') : `${t(d.label)}: ${ok ? t('bor') : t("yo'q")}`;
        const cls = ok
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : warn ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-rose-500/10 text-rose-500/80 dark:text-rose-300/80';
        return <span key={d.key} title={tip} className={`grid h-5 w-5 place-items-center rounded text-[9px] font-bold ${cls}`}>{t(d.short)}</span>;
      })}
    </div>
  );
}

function AjrimPanel({ caseNumber, registryDecline }: { caseNumber: string; registryDecline: boolean }) {
  const t = useT();
  const [data, setData] = useState<Ajrim | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null); setData(null);
    fetch(`/konveyer/court-return-ajrim?caseNumber=${encodeURIComponent(caseNumber)}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) setErr(d?.error || t('Ajrim olinmadi'));
        else setData(d);
      })
      .catch(() => { if (alive) setErr(t('Tarmoq xatosi')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [caseNumber]);
  if (loading) return <div className="flex items-center gap-2 text-[12px] text-muted"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500/40 border-t-brand-500" /> {t('Ajrim olinmoqda…')}</div>;
  if (err) return <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">{err}</div>;
  if (!data) return null;
  return (
    <div className="space-y-2">
      {data.ajrimType && <div className="text-[13px] font-semibold">{data.ajrimType}</div>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {data.judge && <span>{t('Sudya:')} <b className="font-medium text-fg">{data.judge}</b></span>}
        {data.court && <span>{data.court}</span>}
        {data.outgoingDate && <span>{dmy(data.outgoingDate)}</span>}
      </div>
      {data.available ? (
        <a href={`/konveyer/court-return-ajrim/download?caseNumber=${encodeURIComponent(caseNumber)}`} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-brand-700 outline-none transition-colors hover:bg-brand-500/15 focus-visible:ring-2 focus-visible:ring-brand-500/30 dark:text-brand-300">
          <Ico.download size={14} /> {t('Ajrimni ochish (PDF)')}
        </a>
      ) : (
        // Reyestr (devonxona) darajasida qaytarilgan ishda ajrim CHIQMAYDI — sabab decline_reasons'da
        // (memory adolat-decline-reasons). «Hali mavjud emas» deyish chalg'itardi.
        <div className="text-[12px] leading-relaxed text-muted">
          {registryDecline
            ? t('Bu ish ro‘yxatga olishda (devonxonada) qaytarilgan — bunday ishga ajrim chiqarilmaydi. Sabab yuqoridagi «Sabab» bo‘limida.')
            : t('Ajrim PDF hali mavjud emas.')}
        </div>
      )}
    </div>
  );
}

// ── bitta qator ───────────────────────────────────────────────────────────────────────────
const ReturnLine = React.memo(function ReturnLine({ r, canEdit, checked, onCheck, onDocs, onAjrim, onHold, busy }: {
  r: Row; canEdit: boolean; checked: boolean; onCheck: (id: number, v: boolean) => void;
  onDocs: (r: Row) => void; onAjrim: (r: Row) => void; onHold: (r: Row) => void; busy: boolean;
}) {
  const t = useT();
  const sm = SUB_META[r.sub];
  const rm = REASON_META[r.reasonCode ?? 'none'];
  const firstReason = r.reasons[0] ?? null;
  // Navbatdagi ishni ushlab bo'lmaydi (server ham rad etadi): dvigatel ushlashni partiya o'rtasida ko'rmaydi.
  const holdable = r.sub !== 'redrafted' && r.sub !== 'queued';
  return (
    <div className={`rounded-xl border bg-surface transition-colors ${checked ? 'border-brand-500/60 bg-brand-500/[0.04]' : 'border-line'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2.5 py-2">
        {canEdit && (
          <label className="flex shrink-0 cursor-pointer items-center" title={t('Tanlash')}>
            <input type="checkbox" checked={checked} onChange={(e) => onCheck(r.caseId, e.target.checked)} aria-label={t('Tanlash')} className="peer sr-only" />
            <span className={`grid h-5 w-5 place-items-center rounded-md border-2 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/30 ${checked ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-surface text-transparent hover:border-brand-500/60'}`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>
            </span>
          </label>
        )}
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${sm.chip}`} aria-hidden>{initials(r.clientName)}</span>
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium">{r.clientName || '—'}</span>
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${sm.chip}`} title={t(sm.hint)}>{t(sm.label)}</span>
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${rm.chip}`} title={t(rm.hint)}>{t(rm.label)}</span>
            {r.dupOpen && (
              <span className="shrink-0 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-300" title={t('Portalda shu odamga shu firma nomidan boshqa ochiq ish bor (ko‘pincha eski CREATED qoralama). Qayta qoralama ikkinchi da’vo ochadi — avval portaldagi ortiqchasini o‘chiring.')}>
                {t('Portalda ochiq ish bor')}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            {r.pinfl && <span className="font-mono tabular-nums">{r.pinfl}</span>}
            <span className="max-w-[10rem] truncate rounded bg-surface-2 px-1.5 py-0.5 font-medium" title={r.firmName}>{r.firmName}</span>
            {r.courtName && <span className="max-w-[12rem] truncate" title={r.courtName}>{r.courtName}</span>}
            {r.declinedAt && <span className="tabular-nums" title={t('Qaytgan sana')}>↩ {dmy(r.declinedAt)}</span>}
            {r.portalResultLabel && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600 dark:text-rose-300">{t(r.portalResultLabel)}</span>}
          </div>
        </div>
        <ReadyTiles r={r} />
        <div className="flex shrink-0 items-center gap-1.5">
          {/* CaseDocs'da yuklash/o'chirish bor va u o'qish-rejimini bilmaydi — canEdit=false da ko'rsatilmaydi. */}
          {canEdit && (
            <button onClick={() => onDocs(r)} className={`rounded-lg border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/30 ${r.ready ? 'border-line text-muted hover:border-brand-500/40 hover:text-fg' : 'border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'}`}>
              {r.ready ? t('Hujjatlar') : t('Toʻldirish')}
            </button>
          )}
          <button onClick={() => onAjrim(r)} disabled={!r.portalCaseNumber} title={r.portalCaseNumber ? t('Sud ajrimi (cabinet.sud.uz)') : t('Portal ish raqami topilmadi')} className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-40">
            {t('Ajrim')}
          </button>
          {canEdit && holdable && (
            <button onClick={() => onHold(r)} disabled={busy} title={r.sub === 'held' ? t('Qayta qoralamaga qo‘yib yuborish') : t('Paket tuzatilguncha qayta qoralamaga olinmasin')}
              className={`rounded-lg border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 disabled:opacity-50 ${r.sub === 'held' ? 'border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 focus-visible:ring-emerald-500/30 dark:text-emerald-300' : 'border-violet-500/40 text-violet-600 hover:bg-violet-500/10 focus-visible:ring-violet-500/30 dark:text-violet-300'}`}>
              {busy ? '…' : r.sub === 'held' ? t('Qo‘yib yuborish') : t('Ushlab turish')}
            </button>
          )}
        </div>
      </div>
      {/* Izoh qatori: nima uchun qaytgan / nima xato / nima yetishmaydi — bitta qarashda. */}
      {(firstReason || r.queueError || (!r.ready && r.missing.length > 0 && r.sub !== 'redrafted')) && (
        <div className="space-y-0.5 border-t border-line/70 px-2.5 py-1.5 text-[11px] leading-snug">
          {firstReason && (
            <div className="text-fg/90" title={r.reasons.join('\n')}>
              <span className="font-semibold text-muted">{t('Sabab:')}</span> <span className="line-clamp-2">{firstReason}{r.reasons.length > 1 ? ` (+${r.reasons.length - 1})` : ''}</span>
            </div>
          )}
          {r.queueError && (
            <div className="text-rose-600 dark:text-rose-300"><span className="font-semibold">{t('Xato:')}</span> <span className="line-clamp-2" title={r.queueError}>{r.queueError}</span></div>
          )}
          {!r.ready && r.missing.length > 0 && r.sub !== 'redrafted' && (
            <div className="text-amber-700 dark:text-amber-300">
              <span className="font-semibold">{t('Yetishmaydi:')}</span>{' '}
              {r.missing.map((k) => t(MISSING_LABEL[k] ?? k)).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
const MISSING_LABEL: Record<string, string> = {
  talabnoma: 'talabnoma', scan: 'skan', oferta: 'oferta', receipt: 'check', delivery: 'yetkazilganlik isboti', boji: 'invoice raqami',
};

// ── asosiy komponent ──────────────────────────────────────────────────────────────────────
export function ReturnsTab({ snapshotId, firmId, canEdit, active = true }: { snapshotId?: number; firmId?: number; canEdit: boolean; /** tab ko'rinib turibdimi — yashirin bo'lsa davriy yangilash yo'q */ active?: boolean }) {
  const t = useT();
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [subF, setSubF] = useState<ReturnSub | 'all'>('all');
  const [reasonF, setReasonF] = useState<ReasonCode | 'none' | 'all'>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [docsFor, setDocsFor] = useState<Row | null>(null);
  const [ajrimFor, setAjrimFor] = useState<Row | null>(null);
  const [holdBusy, setHoldBusy] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [reasonsRun, setReasonsRun] = useState<{ running: boolean; fetched: number; failed: number; remaining: number } | null>(null);
  const [showCabinet, setShowCabinet] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const reqRef = useRef(0);
  const stopReasons = useRef(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (snapshotId != null) p.set('s', String(snapshotId));
    if (firmId != null) p.set('firmId', String(firmId));
    return p.toString();
  }, [snapshotId, firmId]);

  const load = useCallback(async (soft = false) => {
    const my = ++reqRef.current;
    if (soft) setRefreshing(true); else { setLoading(true); setErr(null); }
    try {
      const d = await getJson<Data>(`/konveyer/sud-returns?${qs}`, undefined, t);
      if (my !== reqRef.current) return;
      setData(d); setErr(null); setUpdatedAt(hm(new Date()));
    } catch (e) {
      if (my === reqRef.current) setErr(e instanceof Error ? e.message : t('Yuklanmadi'));
    } finally {
      if (my === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [qs, t]);

  // Firma/snapshot almashsa — filtrlar va tanlov noldan (boshqa firmaning tanlovi qolib ketmasin).
  useEffect(() => { setSelected(new Set()); setSubF('all'); setReasonF('all'); setLimit(PAGE); load(); }, [load]);
  useEffect(() => () => { stopReasons.current = true; }, []);

  // Navbatda ish bor yoki COURT_SUBMIT partiyasi ketayotgan ekan — 15s da yengil yangilash (holatlar
  // o'zi o'zgaradi: navbatda → qayta tayyorlandi / xato). Bo'sh sahifa hech narsa so'ramaydi.
  const live = (data?.counts.bySub.queued ?? 0) > 0 || !!data?.activeJob;
  useEffect(() => {
    if (!live || !active) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 15_000);
    return () => clearInterval(id);
  }, [live, load, active]);

  const rows = data?.rows ?? [];
  // Qayta yuklangach: ochiq hujjat modali yangi bayroqlarni ko'rsatsin, tanlovdan yo'qolgan ishlar tushsin.
  useEffect(() => {
    if (!data) return;
    const byId = new Map(data.rows.map((r) => [r.caseId, r]));
    setDocsFor((cur) => (cur ? byId.get(cur.caseId) ?? cur : cur));
    setSelected((cur) => {
      const nx = new Set([...cur].filter((id) => byId.has(id)));
      return nx.size === cur.size ? cur : nx;
    });
  }, [data]);
  const shown = useMemo(() => {
    return rows.filter((r) => {
      if (subF !== 'all' && r.sub !== subF) return false;
      if (reasonF !== 'all' && (r.reasonCode ?? 'none') !== reasonF) return false;
      // Puzzy: ismga ~70% (fuzzy.ts), PINFL/firma/sud/ish raqami — substring.
      return matchesFuzzy({ name: r.clientName, pinfl: r.pinfl, extras: [r.firmName, r.courtName, r.portalCaseNumber] }, q);
    });
  }, [rows, subF, reasonF, q]);
  useEffect(() => { setLimit(PAGE); }, [subF, reasonF, q]);

  // Firma bo'yicha: total = shu firmada qaytganlar; eligible = qayta qoralamaga tayyorlar (waiting|failed & sendable & !dupOpen).
  const byFirm = useMemo(() => {
    const m = new Map<number, { firmId: number; firmName: string; total: number; eligible: number }>();
    for (const r of rows) {
      const e = m.get(r.firmId) ?? { firmId: r.firmId, firmName: r.firmName, total: 0, eligible: 0 };
      e.total += 1;
      if (eligible(r)) e.eligible += 1;
      m.set(r.firmId, e);
    }
    return [...m.values()].sort((a, b) => (b.eligible - a.eligible) || (b.total - a.total));
  }, [rows]);
  const totalEligible = useMemo(() => byFirm.reduce((s, f) => s + f.eligible, 0), [byFirm]);
  const dupBlocked = useMemo(() => rows.filter((r) => (r.sub === 'waiting' || r.sub === 'failed') && r.sendable && r.dupOpen).length, [rows]);
  // Server bilan AYNI ta'rif (fetchDeclineReasons): sababi yo'q/eskirgan VA portal id'si bor (so'rab bo'ladi).
  const staleReasons = useMemo(() => rows.filter((r) => (!r.reasonsAt || (!!r.declinedAt && r.reasonsAt < r.declinedAt)) && (!!r.declinedCaseId || !!r.portalCaseNumber)).length, [rows]);

  const onCheck = useCallback((id: number, v: boolean) => {
    setSelected((s) => { const nx = new Set(s); if (v) nx.add(id); else nx.delete(id); return nx; });
  }, []);
  const selRows = useMemo(() => rows.filter((r) => selected.has(r.caseId)), [rows, selected]);

  // ── amallar ──
  const doHold = useCallback(async (ids: number[], hold: boolean) => {
    setHoldBusy((s) => new Set([...s, ...ids]));
    try {
      const r = await postJson<{ updated: number; skippedQueued?: number }>('/konveyer/sud-returns/hold', { caseIds: ids, hold }, t);
      const skipped = r.skippedQueued ? ` ${n(r.skippedQueued)} ${t('tasi navbatda — o‘zgartirilmadi.')}` : '';
      setNotice({ tone: 'ok', text: `${n(r.updated)} ${hold ? t('ta ish ushlab turildi.') : t('ta ish qo‘yib yuborildi.')}${skipped}` });
      await load(true);
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : t('Saqlanmadi') });
    } finally {
      setHoldBusy((s) => { const nx = new Set(s); ids.forEach((i) => nx.delete(i)); return nx; });
    }
  }, [load, t]);
  const onHold = useCallback((r: Row) => { void doHold([r.caseId], r.sub !== 'held'); }, [doHold]);
  const onDocs = useCallback((r: Row) => setDocsFor(r), []);
  const onAjrim = useCallback((r: Row) => setAjrimFor(r), []);

  const runRedraft = async (fid: number, firmName: string, ids: number[] | undefined, count: number) => {
    const ok = await confirm({
      title: `${t('Qayta qoralama tayyorlansinmi?')} — ${firmName}`,
      description:
        `${n(count)} ${t('ta qaytgan ish uchun ADOLAT’da yangi qoralama («Murojaatlarim») tayyorlanadi. Sudga YUBORILMAYDI — buni keyin «Sudga o‘tkazish» bo‘limida qilasiz. Hujjati to‘liq bo‘lmagan, ushlab turilgan, navbatdagi va portalda boshqa ochiq ishi bor ishlar olinmaydi.')}`,
      confirmLabel: t('Qayta qoralama tayyorlash'),
    });
    if (!ok) return;
    setBulkBusy(`redraft:${fid}`); setPickerOpen(false);
    try {
      const r = await postJson<{ jobId: number; total: number }>('/konveyer/sud-returns/redraft', { firmId: fid, caseIds: ids, snapshotId: data?.snapshotId ?? snapshotId }, t);
      setNotice({ tone: 'ok', text: `#${r.jobId}: ${n(r.total)} ${t('ta ish qayta qoralamaga navbatga qo‘yildi. Holat shu ro‘yxatda yangilanib boradi.')}` });
      setSelected(new Set());
      await load(true);
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : t('Xatolik') });
    } finally {
      setBulkBusy(null);
    }
  };
  const doRedraft = (fid: number) => {
    const f = byFirm.find((x) => x.firmId === fid);
    if (!f || f.eligible === 0) return;
    void runRedraft(fid, f.firmName, undefined, f.eligible);
  };
  // Primary tugma: bitta firma tayyor → to'g'ridan-to'g'ri; ko'p bo'lsa — kichik pickker modal.
  const openRedraftPicker = () => {
    const ready = byFirm.filter((f) => f.eligible > 0);
    if (ready.length === 0) return;
    if (ready.length === 1) { doRedraft(ready[0].firmId); return; }
    setPickerOpen(true);
  };

  const runReasons = async (ids?: number[]) => {
    const total = ids?.length ?? staleReasons;
    const ok = await confirm({
      title: t('Sabablarni ADOLAT’dan olish'),
      description: `${n(total)} ${t('ta ish uchun rad etish sababi ADOLAT’dan birma-bir olinadi (har biri ~4 soniya, IP bloklanmasligi uchun sekin). Bir urinishda 30 tadan; oyna ochiq tursa qolgani o‘zi davom etadi. To‘xtatish mumkin.')}`,
      confirmLabel: t('Boshlash'),
    });
    if (!ok) return;
    stopReasons.current = false;
    let fetched = 0; let failed = 0;
    setReasonsRun({ running: true, fetched, failed, remaining: total });
    setNotice(null);
    try {
      for (let round = 0; round < 200; round++) {
        const r = await postJson<ReasonsRes>('/konveyer/sud-returns/reasons', { firmId, caseIds: ids, snapshotId: data?.snapshotId ?? snapshotId }, t);
        fetched += r.fetched; failed += r.failed;
        setReasonsRun({ running: true, fetched, failed, remaining: r.remaining });
        if (r.fetched > 0) void load(true); // chiplar har 30 tadan keyin yangilanib borsin
        if (r.needAuth.length) {
          setNotice({ tone: 'warn', text: `${t('Cabinet sessiyasi tugagan:')} ${r.needAuth.join(', ')}. ${t('«Ulanishlar» orqali E-IMZO bilan qayta ulang.')}` });
          break;
        }
        if (r.stopped) {
          setNotice({ tone: 'warn', text: t('ADOLAT ketma-ket javob bermadi — to‘xtatildi. Birozdan keyin qayta urinib ko‘ring.') });
          break;
        }
        // Aniq tanlov bir martada (≤30); umumiy rejimda «qolgan» tugaguncha. Bitta ham olinmagan
        // chaqiruvdan keyin to'xtaymiz — aks holda olib bo'lmaydigan qatorlar ustida aylanib qolardi.
        if (ids || r.remaining === 0 || r.fetched === 0 || stopReasons.current) {
          if (!ids && r.fetched === 0 && r.failed > 0) setNotice({ tone: 'warn', text: `${n(r.failed)} ${t('ta ish uchun sabab olinmadi (portal id topilmadi yoki ish o‘chirilgan).')}` });
          break;
        }
      }
      await load(true);
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : t('Sabablar olinmadi') });
    } finally {
      setReasonsRun((s) => (s ? { ...s, running: false } : s));
    }
  };

  // ── HeaderShell yaratamiz ─────────────────────────────────────────────────────────────
  const total = data?.counts.total ?? 0;
  const sub = data?.counts.bySub ?? ({ waiting: 0, held: 0, queued: 0, failed: 0, redrafted: 0 } as Record<ReturnSub, number>);
  const byReason = data?.counts.byReason ?? {};
  const reasonKeys = REASON_ORDER.filter((k) => (byReason[k] ?? 0) > 0);
  const selEligible = selRows.filter(eligible);
  const selFirms = [...new Set(selEligible.map((r) => r.firmId))];
  const noPending = !reasonsRun?.running ? staleReasons === 0 : true;
  const activeJob = data?.activeJob ?? null;
  const activeFirmName = activeJob?.firmId != null ? (rows.find((r) => r.firmId === activeJob.firmId)?.firmName ?? '') : '';

  const primary = totalEligible > 0
    ? { label: `${t('Qayta qoralama')} (${n(totalEligible)})`, tone: 'brand' as const, onClick: openRedraftPicker, disabled: !!bulkBusy || !!activeJob, title: activeJob ? t('Bir vaqtda bitta partiya — ketayotgani tugagach boshlanadi.') : undefined }
    : { label: t('Qayta qoralama'), tone: 'brand' as const, onClick: () => {}, disabled: true, title: t('Tayyor qaytgan ish yo‘q') };

  const secondary = [
    { label: reasonsRun?.running ? `${t('Sabablar olinmoqda…')} (${n(reasonsRun.fetched)})` : t('Sabablarni yangilash'), onClick: () => { if (reasonsRun?.running) stopReasons.current = true; else void runReasons(); }, disabled: !reasonsRun?.running && (noPending || !canEdit || !!bulkBusy) },
    { label: `${t('Portaldagi ro‘yxat')} ▾`, onClick: () => setShowCabinet((v) => !v) },
  ];

  const running = activeJob ? { firmName: activeFirmName || t('Firma'), kindLabel: activeJob.fromReturns ? 'qaytganlardan qoralama' : (activeJob.kind === 'draft' ? 'qoralama' : 'sudga o‘tkazish'), progress: activeJob.progress, total: activeJob.total } : null;

  const noticeHeader = sub.failed > 0
    ? { tone: 'err' as const, text: `${n(sub.failed)} ${t('ta xato — pastdagi ro‘yxatdan sababini ko‘ring')}` }
    : null;

  const firmRows: FirmRow[] = byFirm.map((f) => {
    const chips: FirmRow['chips'] = [{ label: `${n(f.total)} ${t('qaytgan')}`, tone: 'slate' }];
    if (f.eligible > 0) chips.push({ label: `${n(f.eligible)} ${t('tayyor')}`, tone: 'emerald' });
    const isRunning = activeJob?.firmId === f.firmId;
    const action = f.eligible > 0
      ? { label: `${t('Qayta qoralama')} (${n(f.eligible)})`, tone: 'brand' as const, onClick: () => doRedraft(f.firmId), disabled: !canEdit || !!bulkBusy || !!activeJob, title: activeJob ? t('Bir vaqtda bitta partiya — ketayotgani tugagach boshlanadi.') : undefined }
      : (f.total > 0 ? { label: t('Sabab kutilmoqda'), tone: 'slate' as const, onClick: () => {}, disabled: true, title: t('Sababi hali olinmagan — «Sabablarni yangilash»ni bosing') } : null);
    return {
      firmId: f.firmId,
      firmName: f.firmName,
      chips,
      running: isRunning ? { progress: activeJob!.progress, total: activeJob!.total, kindLabel: 'qayta qoralama' } : null,
      action,
      emptyText: !action ? t('Qaytgan ish yo‘q') : undefined,
    };
  });

  return (
    <div className="space-y-4">
      <HeaderShell
        title="Qaytganlar"
        subtitle="Sud qaytargan ishlarni sababiga qarab tuzatib, qayta qoralamaga o‘tkazing"
        firmSlot={null}
        updatedAt={updatedAt}
        primary={primary}
        secondary={secondary}
        stats={[
          { key: 'total', label: 'Jami', value: total, tone: 'slate' },
          { key: 'waiting', label: 'Kutmoqda', value: sub.waiting, tone: 'amber' },
          { key: 'held', label: 'Ushlangan', value: sub.held, tone: 'violet' },
          { key: 'queued', label: 'Navbatda', value: sub.queued, tone: 'sky' },
          { key: 'redone', label: 'Tayyorlangan', value: sub.redrafted, tone: 'emerald' },
        ]}
        running={running}
        notice={noticeHeader}
      />

      <FirmQueue
        title="Firmalar bo‘yicha qaytganlar"
        rows={firmRows}
        empty="Qaytgan ish yo‘q"
      />

      {/* Ro'yxat — filtr chip'lari · qidiruv · ReturnLine'lar. Explainer/Stepper/perfirm strip yo'q. */}
      <div className="card p-4">
        {notice && (
          <div role="status" className={`mb-3 flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-[12px] ${notice.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300' : notice.tone === 'warn' ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300' : 'border-rose-500/30 bg-rose-500/[0.05] text-rose-600 dark:text-rose-300'}`}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label={t('Yopish')} className="shrink-0 opacity-70 hover:opacity-100">✕</button>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            <div className="flex gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-24" />)}</div>
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : err ? (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-xs text-rose-500">
            <span>{err}</span>
            <button onClick={() => load()} className="rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">{t('Qayta urinish')}</button>
          </div>
        ) : total === 0 ? (
          <div className="grid place-items-center gap-1 rounded-xl border border-dashed border-line px-4 py-10 text-center">
            <Ico.check size={22} className="text-emerald-500" />
            <div className="text-sm font-medium">{t('Qaytgan ish yo‘q')}</div>
            <div className="max-w-md text-[12px] text-muted">{t('Sud qaytargan ishlar shu yerda paydo bo‘ladi. Portal holati worker tomonidan muntazam tekshiriladi.')}</div>
          </div>
        ) : (
          <>
            {/* Holat bo'yicha chiplar (filtr) — stat sonlar bilan bir xil so'z. */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setSubF('all')} aria-pressed={subF === 'all'}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors ${subF === 'all' ? 'bg-brand-500 text-white shadow-sm' : 'bg-surface-2 text-muted hover:text-fg'}`}>
                {t('Hammasi')} <span>{n(total)}</span>
              </button>
              {SUB_ORDER.filter((s) => (sub[s] ?? 0) > 0).map((s) => {
                const m = SUB_META[s];
                const on = subF === s;
                return (
                  <button key={s} type="button" onClick={() => setSubF(on ? 'all' : s)} aria-pressed={on} title={t(m.hint)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${on ? m.active : `${m.chip} hover:brightness-95`}`}>
                    <span className={`h-2 w-2 rounded-full ${on ? 'bg-white/80' : m.dot}`} aria-hidden />
                    {t(m.label)} <span className="font-semibold tabular-nums">{n(sub[s])}</span>
                  </button>
                );
              })}
              <button onClick={() => load(true)} disabled={loading || refreshing} aria-label={t('Yangilash')} title={t('Yangilash')} className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-line text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50">
                <svg className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
              </button>
            </div>
            {/* Sabab bo'yicha chiplar */}
            {reasonKeys.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('Sabab')}</span>
                {reasonKeys.map((k) => {
                  const m = REASON_META[k];
                  const on = reasonF === k;
                  return (
                    <button key={k} type="button" onClick={() => setReasonF(on ? 'all' : k)} aria-pressed={on} title={t(m.hint)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${on ? m.active : `${m.chip} hover:brightness-95`}`}>
                      {t(m.label)} <span className="font-semibold tabular-nums">{n(byReason[k] ?? 0)}</span>
                    </button>
                  );
                })}
                {(subF !== 'all' || reasonF !== 'all') && (
                  <button onClick={() => { setSubF('all'); setReasonF('all'); }} className="rounded-lg px-2 py-0.5 text-[11px] font-medium text-muted hover:text-fg">{t('Filterni tozalash')}</button>
                )}
              </div>
            )}

            {dupBlocked > 0 && (
              <div className="mb-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-2.5 py-1.5 text-[11px] text-rose-600 dark:text-rose-300">
                {n(dupBlocked)} {t('ta tayyor ish olinmaydi: portalda shu odamga boshqa ochiq ish bor («Portalda ochiq ish bor»). Avval ortiqchasini portalda o‘chiring.')}
              </div>
            )}

            {/* qidiruv */}
            <div className="relative mb-2">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Qidirish')} placeholder={t('F.I.O, PINFL, firma, sud yoki ish raqami…')} className="w-full rounded-xl border border-line bg-surface py-2 pl-10 pr-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" />
            </div>

            {/* tanlov paneli — ushlab/qo'yib yuborish + sababi olish (qayta qoralama HeaderShell orqali) */}
            {canEdit && selected.size > 0 && (
              <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-surface px-2.5 py-2 shadow-sm">
                <span className="text-[12px] font-semibold tabular-nums">{n(selected.size)} {t('ta tanlandi')}</span>
                <button onClick={() => doHold([...selected], true)} disabled={holdBusy.size > 0} className="rounded-lg border border-violet-500/40 px-2 py-1 text-[11px] font-medium text-violet-600 hover:bg-violet-500/10 disabled:opacity-50 dark:text-violet-300">{t('Ushlab turish')}</button>
                <button onClick={() => doHold([...selected], false)} disabled={holdBusy.size > 0} className="rounded-lg border border-emerald-500/40 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300">{t('Qo‘yib yuborish')}</button>
                <button
                  onClick={() => selFirms.length === 1 && runRedraft(selFirms[0], selEligible[0].firmName, selEligible.map((r) => r.caseId), selEligible.length)}
                  disabled={selFirms.length !== 1 || !!bulkBusy || !!activeJob}
                  title={selFirms.length > 1 ? t('Qayta qoralama bir vaqtda bitta firma uchun — bitta firmaning ishlarini tanlang.') : selEligible.length === 0 ? t('Tanlanganlar orasida qayta qoralamaga tayyor ish yo‘q.') : ''}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                  {t('Qayta qoralama')} ({n(selEligible.length)})
                </button>
                <button onClick={() => runReasons([...selected].slice(0, 30))} disabled={!!reasonsRun?.running} className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted hover:text-fg disabled:opacity-50">{t('Sababini olish')}</button>
                <button onClick={() => setSelected(new Set())} className="ml-auto rounded-lg px-2 py-1 text-[11px] text-muted hover:text-fg">{t('Bekor')}</button>
              </div>
            )}

            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
              <span>{n(shown.length)} {t('ta ish')}{q && ` · «${q}»`}</span>
              {canEdit && shown.length > 0 && (
                <button onClick={() => setSelected(new Set(shown.slice(0, 1000).map((r) => r.caseId)))} className="hover:text-fg">{t('Ko‘rinayotganlarni belgilash')}</button>
              )}
            </div>

            {shown.length === 0 ? (
              <div className="grid h-16 place-items-center text-center text-xs text-muted">{q ? `«${q}» ${t('topilmadi')}` : t('Bu filtrda ish yoʻq.')}</div>
            ) : (
              <div className="space-y-1.5">
                {shown.slice(0, limit).map((r) => (
                  <ReturnLine key={r.caseId} r={r} canEdit={canEdit} checked={selected.has(r.caseId)} onCheck={onCheck} onDocs={onDocs} onAjrim={onAjrim} onHold={onHold} busy={holdBusy.has(r.caseId)} />
                ))}
                {shown.length > limit && (
                  <button onClick={() => setLimit((l) => l + PAGE)} className="w-full rounded-xl border border-dashed border-line py-2 text-xs font-medium text-muted transition-colors hover:border-brand-500/40 hover:text-fg">
                    {t('Yana ko‘rsatish')} ({n(Math.min(PAGE, shown.length - limit))} / {n(shown.length - limit)})
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Portaldagi qaytganlar — secondary tugma orqali ochiladi. */}
      {showCabinet && (
        <div className="rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div>
              <h3 className="text-[13px] font-semibold">{t('Portaldagi qaytganlar')}</h3>
              <p className="text-[11px] text-muted">{t('cabinet.sud.uz natijasi bo‘yicha (ajrim bilan qaytarilganlar ham) — faqat ko‘rish va Excel.')}</p>
            </div>
            <button onClick={() => setShowCabinet(false)} aria-label={t('Yopish')} className="rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:text-fg">{t('Yopish')}</button>
          </div>
          <div className="p-3"><CabinetReturns snapshotId={snapshotId} firmId={firmId} /></div>
        </div>
      )}

      {/* Firma pickker — bir nechta firma tayyor bo'lganda */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('Qaysi firma uchun qayta qoralama?')}
        description={t('Bir vaqtda bitta firma — bittasini tanlang.')}
        size="sm"
        footer={<button onClick={() => setPickerOpen(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-fg">{t('Bekor')}</button>}
      >
        <ul className="divide-y divide-line">
          {byFirm.filter((f) => f.eligible > 0).map((f) => (
            <li key={f.firmId} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{f.firmName}</div>
                <div className="text-[11px] text-muted">{n(f.total)} {t('qaytgan')} · <span className="text-emerald-600 dark:text-emerald-400">{n(f.eligible)} {t('tayyor')}</span></div>
              </div>
              <button onClick={() => doRedraft(f.firmId)} disabled={!!bulkBusy || !!activeJob}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                {t('Qayta qoralama')} ({n(f.eligible)})
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      {/* Hujjatlar modali */}
      <Modal
        open={!!docsFor}
        onClose={() => setDocsFor(null)}
        title={docsFor?.clientName || t('Mijoz hujjatlari')}
        description={docsFor ? `${docsFor.pinfl ?? ''} · ${docsFor.firmName}` : undefined}
        size="xl"
        footer={
          <>
            <button onClick={() => load(true)} className="btn-ghost text-xs">{t('Yangilash')}</button>
            <button onClick={() => setDocsFor(null)} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600">{t('Yopish')}</button>
          </>
        }
      >
        {docsFor && (
          <div className="space-y-3">
            {docsFor.reasons.length > 0 && (
              <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2.5">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('Sud qaytarish sababi')}</div>
                <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed">
                  {docsFor.reasons.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            <CaseDocs
              caseId={docsFor.caseId} firmId={docsFor.firmId} stage={docsFor.stage} receiptNumber={docsFor.receiptNumber}
              talabnomaSent={docsFor.talabnomaSent} onChange={() => load(true)} courtFlags={docsFor.flags ?? undefined}
            />
          </div>
        )}
      </Modal>

      {/* Ajrim modali */}
      <Modal
        open={!!ajrimFor}
        onClose={() => setAjrimFor(null)}
        title={`${t('Sud ajrimi')} — ${ajrimFor?.clientName ?? ''}`}
        description={ajrimFor?.portalCaseNumber ?? undefined}
        size="md"
        footer={<button onClick={() => setAjrimFor(null)} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600">{t('Yopish')}</button>}
      >
        {ajrimFor?.portalCaseNumber && (
          <div className="space-y-3">
            {ajrimFor.reasons.length > 0 && (
              <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[12px] leading-relaxed">
                <span className="font-semibold">{t('Sabab:')}</span> {ajrimFor.reasons.join('; ')}
              </div>
            )}
            <AjrimPanel
              caseNumber={ajrimFor.portalCaseNumber}
              registryDecline={ajrimFor.portalStatus === 'DECLINED' && !['RETURNED', 'REFUSED', 'UNCONSIDERED'].includes(ajrimFor.portalResult ?? '')}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

export default ReturnsTab;
