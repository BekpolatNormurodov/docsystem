'use client';

// «Sudga o‘tkazish» — /sud 3-tab (2026-09-19; qobiq 2026-09-20 sodalashtirildi).
//
// ADOLAT'da ALLAQACHON saqlangan da'vo qoralamalari («Murojaatlarim», holati CREATED) shu
// yerdan API orqali sudga topshiriladi. Real yuborishning YAGONA yo'li — shu tab (eski
// prepare-ready real yo'li va REAL navbatni avtomat davom ettirish o'chirilgan). Ataylab
// qo'yilgan to'siqlar: server ruxsati (CABINET_ALLOW_SEND_TO_COURT) + umumiy pauza + firma
// pauzasi; har partiya oldidan firma E-IMZO kaliti bilan imzo (server attestatsiyasi ≤10
// daq); imzodan keyin «YUBORISH» so'zini qo'lda yozish — tasodifiy bosish bilan ketmasin.
//
// 2026-09-20 sodalashtirish (operator «bir xil son har xil so'z bilan» shikoyati):
//   • yagona HeaderShell + FirmQueue — 3 ta katta card o'rniga bitta shell + navbat;
//   • yagona «Ketmoqda» strip HeaderShell.running'da — takror ketayotgan chiplar olib
//     tashlandi (per-firma qatorda ham pulsing «ketmoqda M/N» chip — bir manba);
//   • vokabular: «Ketmoqda» / «tayyor» / «Sudda» / «To'siq» (bir tushuncha — bir so'z);
//   • sticky pastki panel olib tashlandi (amallar HeaderShell primary/secondary'da);
//   • 3 qadam ko'rsatmasi va 8-modda huquqiy xavfi — <details> «Batafsil»ga yig'ildi.
// Backend: GET/POST /konveyer/sud-send (SEND-BE), kontrakt SUD_TABS_SPEC.md dagi kabi.

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Modal, Skeleton, useConfirm } from '@/ui';
import { useT } from '@/lib/i18n/client';
import { COURT_STATUS_UZ } from '@/lib/court-result';
import { Dropdown } from './Dropdown';
import { KeyPicker } from './KeyPicker';
import { HeaderShell } from './_shared/HeaderShell';
import { FirmQueue } from './_shared/FirmQueue';

// ── kontrakt turlari (GET/POST /konveyer/sud-send) ────────────────────────────
type SendBlocker =
  | 'NO_CASE_ID' | 'SUBMITTED' | 'HELD' | 'BOJI_UNPAID' | 'NO_DELIVERY'
  | 'OLD_PACKAGE' | 'PORTAL_NOT_CREATED' | 'QUEUED' | 'SENDING' | 'CHECK';
type SendState = 'SENDING' | 'SENT' | 'FAILED' | 'CHECK';
interface SendGateFirm { firmId: number; firmName: string; paused: boolean; attestedAt: string | null; attestFresh: boolean }
interface SendGate { envAllowed: boolean; globalPaused: boolean; firms: SendGateFirm[] }
interface SendRow {
  caseId: number; firmId: number; firmName: string; clientName: string | null; pinfl: string | null;
  courtName: string | null; cabinetCaseId: string; suitReadyAt: string; portalStatus: string | null; portalCheckedAt: string | null;
  bojiPaid: boolean; delivered: boolean; blockers: SendBlocker[]; eligible: boolean;
  send: { state: SendState; at: string; error?: string } | null; totalDebt: number | null;
}
interface ActiveJob { id: number; firmId: number; kind: 'send' | 'draft' | 'real'; progress: number; total: number }
interface SendData {
  gate: SendGate;
  rows: SendRow[];
  // Partial — server yangi to‘siq kodini qo‘shsa ham yoki ba‘zisini tashlab ketsa ham UI yiqilmasin.
  counts: { total: number; eligible: number; byBlocker: Partial<Record<SendBlocker, number>> };
  activeJob: ActiveJob | null;
}

// POST javobi (court-send-suits.ts createSendSuitsJob): muvaffaqiyatda `excluded` — sud limiti/oynasi
// sabab bu partiyaga kirmaganlar; rad etilganda `rejected` — har ish nega yaroqsiz (UI ro'yxati eskirgan).
type ExcludedCase = { caseId: number; reason: string };
type RejectedCase = { caseId: number; blockers: string[] };
type PostResult = { jobId?: number; total?: number; error?: string; excluded?: ExcludedCase[]; rejected?: RejectedCase[] };

// `firms` — /sud sahifasidagi loadStageData().firms (StageFirm) bilan AYNAN bir shakl:
// SudTabs uni CourtManager'ga qanday bersa, bizga ham shunday beradi. Spec'dagi
// `{id, shortName, stir}` emas — haqiqiy manba shu (stage-data.ts StageFirm). `total` bu
// yerda ishlatilmaydi, shuning uchun ixtiyoriy.
export interface SendSuitsFirm { firmId: number; firmName: string; total?: number; stir?: string | null }
// Spec'dagi muqobil shakl ham qabul qilinadi — SudTabs qaysi birini bersa ham integratsiya
// buzilmasin (ikki agent parallel yozmoqda). Ichkarida bitta shaklga keltiriladi.
type SendSuitsFirmInput = SendSuitsFirm | { id: number; shortName: string; stir?: string | null };

// Server ham shu chegarani tekshiradi (POST 1..100) — bu faqat UI'da oldindan ko'rsatish uchun.
const MAX_SEND = 100;
// Attestatsiya serverda ≤10 daqiqa amal qiladi. 30 soniya zaxira: imzo 9:59 da eskirib, POST
// yo'lda rad etilmasin — operatorga oldindan «qayta imzolang» deymiz.
const ATTEST_MS = 10 * 60_000 - 30_000;
const PAGE = 50;
// Qo'lda yoziladigan tasdiq so'zi. t() ga BERILMAYDI: uz-cyrl'da avtomatik kirillga
// o'girilib «ЮБОРИШ» bo'lib qolardi va operator nima yozishini bilmay qolardi. Kirill
// klaviaturada yozganni ham qabul qilamiz.
const CONFIRM_WORD = 'YUBORISH';
const CONFIRM_WORD_CYRL = 'ЮБОРИШ';
const TERMINAL = new Set(['DONE', 'FAILED', 'CANCELED']);

const n = (x: number) => x.toLocaleString('ru-RU');
const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/**
 * JSON kutilgan so'rov uchun o'quvchi (CourtManager.getJson bilan bir xil qoida — u
 * eksport qilinmagan, shuning uchun nusxa). Sessiya tugaganda server login'ga yo'naltiradi
 * va brauzer 200 + HTML oladi: `res.json()` tushunarsiz «Unexpected token '<'» bilan
 * yiqilardi. Content-type tekshiriladi va aniq sabab yoziladi; `{error}` ham ko'rsatiladi.
 */
async function getJson<T = unknown>(url: string, init: RequestInit | undefined, t: (s: string) => string): Promise<T> {
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

// ── to'siq kodlari → odam tilida (yorliq + tooltip) ──────────────────────────
// Tartib = ahamiyat: avval «umuman yuborilmaydi», keyin «tuzatsa bo'ladi», oxirida vaqtinchalik.
const BLOCKER_ORDER: SendBlocker[] = ['SUBMITTED', 'CHECK', 'SENDING', 'QUEUED', 'PORTAL_NOT_CREATED', 'OLD_PACKAGE', 'BOJI_UNPAID', 'NO_DELIVERY', 'HELD', 'NO_CASE_ID'];
const BLOCKER_INFO: Record<SendBlocker, { label: string; hint: string; tone: Tone }> = {
  NO_CASE_ID: { label: 'ADOLAT ID yo‘q', hint: 'Ishda ADOLAT ish raqami saqlanmagan — qaysi da‘voni yuborish noma‘lum. Qoralamani qaytadan tayyorlang.', tone: 'rose' },
  SUBMITTED: { label: 'Sudga yuborilgan', hint: 'Bu odamga shu firma nomidan da‘vo allaqachon berilgan (tizim yoki yurist; ko‘rilayotgan yoki hal bo‘lgan) — ikkinchi da‘vo yuborilmaydi.', tone: 'indigo' },
  HELD: { label: 'Ushlab turilgan', hint: 'Sud qaytargan va paket tuzatilguncha ushlab turilgan — «Qaytganlar» tabida boshqariladi.', tone: 'slate' },
  BOJI_UNPAID: { label: 'Boji to‘lanmagan', hint: 'Davlat boji invoysi hali to‘lanmagan. Buxgalteriya to‘lagach ish o‘zi yuborishga tayyor bo‘ladi.', tone: 'amber' },
  NO_DELIVERY: { label: 'Talabnoma yetkazilmagan', hint: 'Talabnoma qarzdorga yetkazilgani isbotlanmagan (pochta dalili yo‘q) — sudya aynan shu sababdan qaytaradi.', tone: 'amber' },
  OLD_PACKAGE: { label: 'Eski paket', hint: 'Qoralama 2026-09-18 dagi paket tuzatishlaridan oldin saqlangan (oferta/grafik/check nuqsonli). Saqlangan da‘vo hujjatlarini o‘zgartirib bo‘lmaydi — qoralamani qaytadan tayyorlang.', tone: 'rose' },
  PORTAL_NOT_CREATED: { label: 'Portal holati mos emas', hint: 'ADOLAT portalida bu da‘vo «Yaratilgan» holatida emas: yurist o‘zi yuborgan, o‘chirilgan yoki holat hali sinxronlanmagan. Portalda tekshiring.', tone: 'rose' },
  QUEUED: { label: 'Navbatda', hint: 'Bu ish boshqa partiya navbatida turibdi — o‘sha partiya tugashini kuting.', tone: 'sky' },
  SENDING: { label: 'Yuborilmoqda', hint: 'Hozir yuborilyapti — natijani kuting.', tone: 'sky' },
  CHECK: { label: 'Tekshirish kerak', hint: 'Oldingi yuborishda javob noaniq bo‘ldi (aloqa uzildi) — da‘vo sudga ketgan bo‘lishi mumkin. Qayta yuborishdan oldin portalda qo‘lda tekshiring.', tone: 'amber' },
};
// Serverning qayta tekshiruvi qo'shadigan, ro'yxatda uchramaydigan kodlar.
const REJECT_EXTRA: Record<string, string> = {
  NOT_FOUND: 'Ish topilmadi',
  OTHER_FIRM: 'Boshqa firma ishi',
  DUPLICATE: 'Bir odamning ikkinchi da‘vosi',
};
const EXCLUDE_INFO: Record<string, string> = {
  COURT_NOT_ASSIGNED: 'Sud biriktirilmagan',
  COURT_NOT_ALLOWED: 'Sud firma sudlari ro‘yxatida yo‘q',
  QUOTA_OR_WINDOW: 'Sud kunlik limiti tugagan yoki ish vaqti emas',
};
const SEND_INFO: Record<SendState, { label: string; tone: Tone }> = {
  SENDING: { label: 'Yuborilmoqda', tone: 'sky' },
  SENT: { label: 'Sudga ketdi', tone: 'emerald' },
  FAILED: { label: 'Yuborilmadi', tone: 'rose' },
  CHECK: { label: 'Tekshirish kerak', tone: 'amber' },
};
// Portal holatlari: court-result.ts'dagi xarita + u yerda yo'q ikkitasi (REGISTER/ALLOCATE —
// sudga yuborilgandan keyingi birinchi bosqichlar, aynan shu tabdan keyin ko'rinadi).
const PORTAL_STATUS_UZ: Record<string, string> = { ...COURT_STATUS_UZ, REGISTER: 'Roʻyxatga olingan', ALLOCATE: 'Sudyaga taqsimlangan' };
// HeaderShell.running.kindLabel uchun kichik harf (bosh so'z «Ketmoqda:» oldida keladi).
const JOB_KIND_LABEL: Record<ActiveJob['kind'], string> = { send: 'sudga yuborish', draft: 'qoralama (1 qadam)', real: 'eski real yuborish' };

// Literal sinflar (Tailwind JIT interpolatsiyani ko'rmaydi).
type Tone = 'slate' | 'sky' | 'amber' | 'emerald' | 'rose' | 'teal' | 'indigo';
const CHIP: Record<Tone, string> = {
  slate: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rose: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  indigo: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
};
const CHIP_ON: Record<Tone, string> = {
  slate: 'bg-slate-600 text-white', sky: 'bg-sky-600 text-white', amber: 'bg-amber-500 text-white',
  emerald: 'bg-emerald-600 text-white', rose: 'bg-rose-600 text-white', teal: 'bg-teal-600 text-white', indigo: 'bg-indigo-600 text-white',
};
const DOT: Record<Tone, string> = {
  slate: 'bg-slate-400', sky: 'bg-sky-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500', rose: 'bg-rose-500', teal: 'bg-teal-500', indigo: 'bg-indigo-500',
};

// ── mayda qismlar ─────────────────────────────────────────────────────────────
// Tooltip: CourtManager'dagi Tip'ga o'xshash, lekin (1) uzun izohlar uchun qatorga o'raladi,
// (2) klaviatura fokusida ham ochiladi (group-focus-within) — to'siq sababi faqat sichqoncha
// egalariga ko'rinmasin. Matn DOM'da turadi, ekran o'quvchi uni o'qiydi.
function Tip({ label, children, side = 'top', className }: { label: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom'; className?: string }) {
  return (
    <span className={`group/tip relative inline-flex ${className ?? ''}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-[15rem] -translate-x-1/2 scale-95 whitespace-normal rounded-md bg-slate-900 px-2 py-1 text-left text-[11px] font-medium leading-snug text-white opacity-0 shadow-lg ring-1 ring-black/10 transition-[opacity,transform] duration-150 group-focus-within/tip:scale-100 group-focus-within/tip:opacity-100 group-hover/tip:scale-100 group-hover/tip:opacity-100 dark:bg-slate-700 ${side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}`}
      >
        {label}
      </span>
    </span>
  );
}

function Chip({ tone, children, tip, dot, spin }: { tone: Tone; children: React.ReactNode; tip?: React.ReactNode; dot?: boolean; spin?: boolean }) {
  const body = (
    <span
      tabIndex={tip ? 0 : undefined}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${CHIP[tone]}`}
    >
      {spin ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current/30 border-t-current" aria-hidden />
        : dot ? <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} aria-hidden /> : null}
      {children}
    </span>
  );
  return tip ? <Tip label={tip}>{body}</Tip> : body;
}

// Boji / yetkazilganlik mini-plitkasi (CourtManager DocTile ruhida, lekin yozuvi bilan —
// zich jadvalda ikonka yolg'iz nima ekanini aytmaydi).
function MiniTile({ ok, label, tip }: { ok: boolean; label: string; tip: string }) {
  return (
    <Tip label={tip}>
      <span
        tabIndex={0}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-600 dark:text-rose-300'}`}
      >
        {ok
          ? <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m20 6-11 11-5-5" /></svg>
          : <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>}
        {label}
      </span>
    </Tip>
  );
}

const IcoRefresh = ({ spin }: { spin?: boolean }) => (
  <svg className={`h-4 w-4 ${spin ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
);
const IcoWarn = ({ cls = 'h-5 w-5' }: { cls?: string }) => (
  <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
const IcoSend = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
);

// ── asosiy komponent ──────────────────────────────────────────────────────────
export function SendSuitsTab({ snapshotId, firmId, firms, active = true }: { snapshotId?: number; firmId?: number; firms: SendSuitsFirmInput[]; /** tab ko'rinib turibdimi — yashirin bo'lsa ro'yxat so'ralmaydi (job kuzatuvi davom etadi) */ active?: boolean }) {
  const t = useT();
  const confirm = useConfirm();
  const uid = useId();

  const [firm, setFirm] = useState<number | null>(firmId ?? null);
  // Deep-link (?firm=) o'zgarsa — shu tabning filtri ham ergashadi.
  useEffect(() => { setFirm(firmId ?? null); }, [firmId]);

  const [data, setData] = useState<SendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const reqRef = useRef(0);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [view, setView] = useState<string>('all'); // 'all' | 'eligible' | 'blocked' | 'result' | `b:${SendBlocker}`
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    setRefreshing(true);
    const qs = new URLSearchParams();
    if (firm) qs.set('firmId', String(firm));
    if (snapshotId) qs.set('s', String(snapshotId));
    try {
      const d = await getJson<SendData>(`/konveyer/sud-send?${qs.toString()}`, { cache: 'no-store' }, t);
      if (my !== reqRef.current) return;
      setData(d); setError(null); setLastLoaded(new Date());
    } catch (e) {
      if (my !== reqRef.current) return;
      // Eski ma'lumot SAQLANADI (setData(null) yo'q) — bitta uzilish ro'yxatni o'chirib yubormasin.
      setError(e instanceof Error ? e.message : t('Yuklab boʻlmadi'));
    } finally {
      if (my === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [firm, snapshotId, t]);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  useEffect(() => { void load(); }, [load]);

  // ── partiyani kuzatish (/api/jobs/:id) ────────────────────────────────────
  // CourtManager.pollJob qoidasi: kuzatuv taslim bo'lmaydi, faqat aloqa uzilganini aytadi.
  type JobView = { id: number; firmId: number; firmName: string; status: string; progress: number; total: number; message?: string | null; pollError?: string; test?: boolean; note?: string };
  const [job, setJob] = useState<JobView | null>(null);
  const pollRef = useRef<{ id: number; timer: ReturnType<typeof setInterval> } | null>(null);
  const dismissed = useRef<Set<number>>(new Set());
  const pollJob = useCallback((id: number) => {
    if (pollRef.current?.id === id) return;
    if (pollRef.current) clearInterval(pollRef.current.timer);
    let fails = 0;
    const tick = async () => {
      try {
        const s = await getJson<{ status: string; progress: number; total: number; message?: string | null }>(`/api/jobs/${id}`, { cache: 'no-store' }, t);
        fails = 0;
        setJob((j) => (j && j.id === id ? { ...j, status: s.status, progress: s.progress ?? j.progress, total: s.total || j.total, message: s.message ?? j.message, pollError: undefined } : j));
        if (TERMINAL.has(s.status)) {
          if (pollRef.current?.id === id) { clearInterval(pollRef.current.timer); pollRef.current = null; }
          void loadRef.current();
        }
      } catch (e) {
        if (++fails >= 5) {
          const msg = e instanceof Error ? e.message : t('Holatni o‘qib bo‘lmadi');
          setJob((j) => (j && j.id === id ? { ...j, pollError: `${msg} ${t('— aloqa tiklanishi kutilmoqda (ish serverda davom etyapti)')}` } : j));
        }
      }
    };
    pollRef.current = { id, timer: setInterval(tick, 2000) };
    void tick();
  }, [t]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current.timer); }, []);

  // Firma nomlari: prop (StageFirm) + server gate + qatorlar — prop'da yo'q firma ham nomsiz qolmasin.
  const firmList = useMemo(() => {
    const m = new Map<number, { firmId: number; firmName: string; stir: string | null | undefined }>();
    for (const f of firms) {
      const id = 'firmId' in f ? f.firmId : f.id;
      m.set(id, { firmId: id, firmName: 'firmId' in f ? f.firmName : f.shortName, stir: f.stir ?? null });
    }
    for (const g of data?.gate.firms ?? []) if (!m.has(g.firmId)) m.set(g.firmId, { firmId: g.firmId, firmName: g.firmName, stir: undefined });
    for (const r of data?.rows ?? []) if (!m.has(r.firmId)) m.set(r.firmId, { firmId: r.firmId, firmName: r.firmName, stir: undefined });
    return [...m.values()];
  }, [firms, data]);
  const firmName = useCallback((id: number) => firmList.find((f) => f.firmId === id)?.firmName ?? `#${id}`, [firmList]);

  // Sahifa yangilangach (yoki boshqa oynadan boshlangan) ketayotgan yuborish partiyasini tiklaymiz.
  const activeJob = data?.activeJob ?? null;
  useEffect(() => {
    if (!activeJob || activeJob.kind !== 'send' || dismissed.current.has(activeJob.id)) return;
    if (job?.id === activeJob.id) return;
    setJob({ id: activeJob.id, firmId: activeJob.firmId, firmName: firmName(activeJob.firmId), status: 'RUNNING', progress: activeJob.progress, total: activeJob.total });
    pollJob(activeJob.id);
  }, [activeJob, job?.id, firmName, pollJob]);

  const jobRunning = !!job && !TERMINAL.has(job.status);
  const busy = !!activeJob || jobRunning;
  // Partiya ketayotganda ro'yxat 3 soniyada (har ishning SENDING→SENT holati jonli ko'rinsin),
  // tinch paytda 15 soniyada yangilanadi. Yashirin tab so'rov yubormaydi.
  // 3 soniyalik tez yangilash faqat SUDGA YUBORISH partiyasi uchun (har ishning holati o'zgaradi);
  // Go qoralama partiyasi ketayotganda bu ro'yxat o'zgarmaydi — 15 soniya yetarli.
  const sendBusy = jobRunning || activeJob?.kind === 'send';
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void loadRef.current();
    }, sendBusy ? 3000 : 15_000);
    return () => clearInterval(id);
  }, [sendBusy, active]);

  // Firma almashsa — tanlov, sahifa tozalanadi va URL'dagi ?firm= yangilanadi (deep-link).
  const changeFirm = useCallback((v: number | null) => {
    setFirm(v); setSelected(new Set()); setPage(0);
    try {
      const u = new URL(window.location.href);
      if (v) u.searchParams.set('firm', String(v)); else u.searchParams.delete('firm');
      window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
    } catch { /* URL sinxron bo'lmasa ham filtr ishlaydi */ }
  }, []);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  // Tanlov faqat TANLANGAN firmaning yuborsa bo'ladigan ishlari (attestatsiya firma bo'yicha).
  const selectable = useCallback((r: SendRow) => r.eligible && firm !== null && r.firmId === firm, [firm]);
  // Ro'yxat yangilanganda endi yaroqsiz bo'lib qolgan (masalan, boshqa oynadan yuborilgan) tanlovlar tushib qoladi.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ok = new Set(rows.filter(selectable).map((r) => r.caseId));
      const next = new Set([...prev].filter((id) => ok.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows, selectable]);

  // Tartib: ketayotgan → yuborsa bo'ladigan → xato/tekshirish → to'siqli; ichida eng eski qoralama birinchi.
  const sorted = useMemo(() => {
    const rank = (r: SendRow) => (r.send?.state === 'SENDING' ? 0 : r.eligible ? 1 : r.send && r.send.state !== 'SENT' ? 2 : 3);
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.suitReadyAt.localeCompare(b.suitReadyAt) || a.caseId - b.caseId);
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const nd = digits(needle);
    return sorted.filter((r) => {
      if (view === 'eligible' && !r.eligible) return false;
      if (view === 'blocked' && r.eligible) return false;
      if (view === 'result' && !(r.send && r.send.state !== 'SENDING')) return false;
      if (view.startsWith('b:') && !r.blockers.includes(view.slice(2) as SendBlocker)) return false;
      if (!needle) return true;
      return (r.clientName ?? '').toLowerCase().includes(needle)
        || (!!nd && (r.pinfl ?? '').includes(nd))
        || String(r.cabinetCaseId).toLowerCase().includes(needle) // meta'da raqam bo'lib kelishi mumkin
        || (r.courtName ?? '').toLowerCase().includes(needle);
    });
  }, [sorted, view, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageSafe = Math.min(page, pages - 1);
  const pageRows = filtered.slice(pageSafe * PAGE, pageSafe * PAGE + PAGE);
  useEffect(() => { setPage(0); }, [view, q]);

  const eligibleRows = useMemo(() => sorted.filter(selectable), [sorted, selectable]);
  const resultCount = useMemo(() => rows.filter((r) => r.send && r.send.state !== 'SENDING').length, [rows]);
  const eligibleByFirm = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) if (r.eligible) m.set(r.firmId, (m.get(r.firmId) ?? 0) + 1);
    return m;
  }, [rows]);
  // 2026-09-20: HeaderShell «Sudda» stati — SUBMITTED to'siqli yoki send.state === SENT.
  // Server alohida son bermaydi; qatorlardan hisoblaymiz (ro'yxat filtrsiz — data.rows).
  const sentCount = useMemo(
    () => rows.filter((r) => r.blockers.includes('SUBMITTED') || r.send?.state === 'SENT').length,
    [rows],
  );
  const pauseByFirm = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const f of data?.gate.firms ?? []) if (f.paused) m.set(f.firmId, true);
    return m;
  }, [data]);

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_SEND) next.add(id);
    return next;
  });
  const pageSelectable = pageRows.filter(selectable);
  const pageAllOn = pageSelectable.length > 0 && pageSelectable.every((r) => selected.has(r.caseId));
  const pageSomeOn = pageSelectable.some((r) => selected.has(r.caseId));
  const headBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (headBox.current) headBox.current.indeterminate = pageSomeOn && !pageAllOn; }, [pageSomeOn, pageAllOn]);
  const togglePage = () => setSelected((prev) => {
    const next = new Set(prev);
    if (pageAllOn) { for (const r of pageSelectable) next.delete(r.caseId); return next; }
    for (const r of pageSelectable) { if (next.size >= MAX_SEND) break; next.add(r.caseId); }
    return next;
  });
  // «Tayyorlarni belgilash» (HeaderShell secondary) — joriy firma eligiblari, eng ko'pi 100 (eng eskisidan).
  const selectAllEligible = useCallback(() => {
    setSelected(new Set(eligibleRows.slice(0, MAX_SEND).map((r) => r.caseId)));
  }, [eligibleRows]);
  // FirmQueue qatoridan bosilganda: firmani almashtir va shu firmaning eligible'larini belgila.
  // rows'dan hisoblaymiz (eligibleRows selectable() firm==fid'ga bog'liq, hozircha firm boshqa).
  const selectAllEligibleForFirm = useCallback((fid: number) => {
    const ids = rows.filter((r) => r.eligible && r.firmId === fid).slice(0, MAX_SEND).map((r) => r.caseId);
    setSelected(new Set(ids));
  }, [rows]);

  // ── gate ────────────────────────────────────────────────────────────────────
  const gate = data?.gate ?? null;
  const gateFirm = firm !== null ? gate?.firms.find((f) => f.firmId === firm) ?? null : null;
  const firmMeta = firm !== null ? firmList.find((f) => f.firmId === firm) : undefined;
  const noStir = firmMeta !== undefined && firmMeta.stir !== undefined && !digits(firmMeta.stir);
  // HeaderShell notice — attestatsiya faqat firma tanlanganida tekshiriladi (aks holda «true»).
  const attestFresh = firm === null || !gateFirm ? true : gateFirm.attestFresh;

  // Umumiy sabab — ikkala tugmani ham to'sadi. Tartib = operator avval nimani tuzatishi kerak.
  const blockReason: string | null = (() => {
    if (!data) return t('Maʼlumot yuklanmoqda…');
    if (!gate!.envAllowed) return `${t('Serverda sudga yuborish o‘chirilgan')} (CABINET_ALLOW_SEND_TO_COURT)`;
    if (gate!.globalPaused) return t('Sudga yuborish pauzada — avval yuqoridagi «Yoqish» tugmasini bosing');
    if (busy) {
      const a = activeJob;
      return a && a.kind !== 'send'
        ? `${t('Boshqa partiya ketmoqda')} — ${t('tugashini kuting')}`
        : t('Yuborish partiyasi ketmoqda — tugashini kuting');
    }
    if (firm === null) return t('Yuborish uchun bitta firmani tanlang — E-IMZO tasdig‘i firma bo‘yicha');
    if (gateFirm?.paused) return t('Bu firma bo‘yicha yuborish pauzada');
    if (noStir) return t('Firmada STIR yoʻq — E-IMZO tasdig‘i imkonsiz');
    if (eligibleRows.length === 0) return t('Bu firmada yuborishga tayyor ish yo‘q');
    return null;
  })();
  const bulkReason = blockReason ?? (selected.size === 0 ? t('Hech narsa tanlanmagan — ro‘yxatdan belgilang') : null);
  // Sinov uchun: bitta belgilangan bo'lsa — o'sha; aks holda eng eski, OLDIN URINILMAGAN ishi
  // (oldingi urinishi xato bo'lgan ish sinov natijasini chalkashtiradi), bo'lmasa eng eskisi.
  const testRow = selected.size === 1
    ? eligibleRows.find((r) => selected.has(r.caseId)) ?? null
    : eligibleRows.find((r) => !r.send) ?? eligibleRows[0] ?? null;

  // ── pauza (umumiy) ──────────────────────────────────────────────────────────
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseErr, setPauseErr] = useState<string | null>(null);
  const togglePause = async () => {
    if (!gate || pauseBusy) return;
    const nextPaused = !gate.globalPaused;
    const ok = await confirm(nextPaused
      ? {
          title: t('Sudga yuborishni to‘xtatasizmi?'),
          description: t('Barcha firmalar bo‘yicha sudga yuborish to‘xtatiladi: yangi partiya boshlanmaydi, ketayotgani keyingi ishni yubormaydi. Allaqachon sudga ketgan da‘volar qaytarilmaydi. Qoralama tayyorlash (1 qadam) bu pauzaga bog‘liq emas.'),
          confirmLabel: t('Pauza qilish'),
        }
      : {
          title: t('Sudga yuborishni yoqasizmi?'),
          description: t('Umumiy pauza olib tashlanadi — barcha firmalar uchun sudga real yuborishga ruxsat beriladi. Bu tabda har partiya baribir firma E-IMZO kaliti va yozma tasdiq bilan alohida tasdiqlanadi. Yoqishdan oldin boshqa real yuborish navbati qolmaganiga ishonch hosil qiling.'),
          confirmLabel: t('Yoqish'),
          danger: true,
        });
    if (!ok) return;
    setPauseBusy(true); setPauseErr(null);
    try {
      await getJson('/konveyer/court-queue/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: nextPaused }) }, t);
      await load();
    } catch (e) {
      setPauseErr(e instanceof Error ? e.message : t('Xatolik'));
    } finally { setPauseBusy(false); }
  };

  // ── yuborish oqimi: tanlash → E-IMZO → «YUBORISH» → POST → kuzatish ────────
  type Pending = { firmId: number; firmName: string; stir: string | null | undefined; caseIds: number[]; names: string[]; test: boolean };
  const [pending, setPending] = useState<Pending | null>(null);
  const [stage, setStage] = useState<'sign' | 'confirm' | null>(null);
  const [signed, setSigned] = useState<{ at: number; keyCn?: string | null; verified?: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const [posting, setPosting] = useState(false);
  const postingRef = useRef(false); // closeFlow barqaror bo'lsin (pastga qarang)
  const [postErr, setPostErr] = useState<string | null>(null);
  const [postDetails, setPostDetails] = useState<string[]>([]); // rad etilgan/chetga olingan ishlar — nega
  const typedRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());
  // Tasdiq oynasida imzo muddati sanog'i (faqat oyna ochiq paytda soniyada bir).
  useEffect(() => {
    if (stage !== 'confirm') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const startSend = (test: boolean) => {
    if (firm === null) return;
    if (test ? blockReason || !testRow : bulkReason) return;
    const ids = test ? [testRow!.caseId] : eligibleRows.filter((r) => selected.has(r.caseId)).slice(0, MAX_SEND).map((r) => r.caseId);
    if (ids.length === 0) return;
    const byId = new Map(rows.map((r) => [r.caseId, r]));
    setPending({
      firmId: firm, firmName: firmName(firm), stir: firmMeta?.stir, caseIds: ids, test,
      names: ids.map((id) => { const r = byId.get(id); return r?.clientName || r?.pinfl || `#${id}`; }),
    });
    setSigned(null); setTyped(''); setPostErr(null); setPostDetails([]); setStage('sign');
  };
  // BARQAROR (useCallback, posting ref orqali): @/ui Modal fokus effekti `onClose` ga bog'liq —
  // har renderda yangi funksiya bo'lsa effekt qayta ishga tushib fokusni oynadan tashqariga
  // (ochgan tugmaga) qaytarib yuboradi va «YUBORISH» yozilayotgan maydon fokusni yo'qotadi.
  const closeFlow = useCallback(() => {
    if (postingRef.current) return;
    setStage(null); setPending(null); setSigned(null); setTyped(''); setPostErr(null); setPostDetails([]);
  }, []);
  // KeyPicker yopilganda uning Modal'i fokusni o'zi ochilgan tugmaga qaytaradi — bu yangi
  // oynadagi autoFocus'dan KEYIN sodir bo'ladi. Shuning uchun fokusni ota effektida (bolalar
  // effektlaridan keyin ishlaydi) maydonga qayta qo'yamiz.
  useEffect(() => { if (stage === 'confirm') typedRef.current?.focus(); }, [stage]);

  const typedOk = [CONFIRM_WORD, CONFIRM_WORD_CYRL].includes(typed.trim().toUpperCase());
  const signLeft = signed ? Math.max(0, signed.at + ATTEST_MS - now) : 0;
  const signStale = !!signed && signLeft <= 0;

  // Ish nomi + sabablar (rad etilgan / chetga olingan) — operator qaysi ish nega o'tmaganini ko'rsin.
  const caseLabel = (id: number) => { const r = rows.find((x) => x.caseId === id); return r?.clientName || r?.pinfl || `#${id}`; };
  const reasonLabel = (code: string) => (BLOCKER_INFO[code as SendBlocker] ? t(BLOCKER_INFO[code as SendBlocker].label) : REJECT_EXTRA[code] ? t(REJECT_EXTRA[code]) : EXCLUDE_INFO[code] ? t(EXCLUDE_INFO[code]) : code);
  const excludedNote = (ex: ExcludedCase[] | undefined) => {
    if (!ex?.length) return undefined;
    const by = new Map<string, number>();
    for (const e of ex) by.set(e.reason, (by.get(e.reason) ?? 0) + 1);
    return `${n(ex.length)} ${t('ta ish bu partiyaga kirmadi')}: ${[...by.entries()].map(([r, c]) => `${reasonLabel(r)} — ${n(c)}`).join('; ')}`;
  };

  const submit = async () => {
    if (!pending || !signed || !typedOk || posting) return;
    if (Date.now() - signed.at > ATTEST_MS) { setPostErr(t('E-IMZO tasdig‘i eskirdi (10 daqiqa) — qaytadan imzolang.')); return; }
    setPosting(true); postingRef.current = true; setPostErr(null); setPostDetails([]);
    try {
      // getJson EMAS: 400/409 javobining tanasida `rejected`/`excluded` ham bor — uni yo'qotmaymiz.
      const res = await fetch('/konveyer/sud-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId: pending.firmId, caseIds: pending.caseIds }),
      });
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        throw new Error(res.redirected || res.url.includes('/login')
          ? t('Sessiya tugagan — sahifani yangilab, qaytadan kiring.')
          : `${t('Server JSON qaytarmadi')} (${res.status}). ${t('Sahifani yangilab ko‘ring.')}`);
      }
      const d = (await res.json()) as PostResult;
      if (!res.ok || !d.jobId) {
        const lines = [
          ...(d.rejected ?? []).map((r) => `${caseLabel(r.caseId)}: ${r.blockers.map(reasonLabel).join(', ')}`),
          ...(d.excluded ?? []).map((e) => `${caseLabel(e.caseId)}: ${reasonLabel(e.reason)}`),
        ];
        setPostDetails(lines);
        if (lines.length) void load(); // ro'yxat eskirgan — yangilab qo'yamiz, operator qayta tanlaydi
        throw new Error(d.error || `${t('Server xatosi')} (${res.status})`);
      }
      setJob({ id: d.jobId, firmId: pending.firmId, firmName: pending.firmName, status: 'PENDING', progress: 0, total: d.total ?? pending.caseIds.length, test: pending.test, note: excludedNote(d.excluded) });
      pollJob(d.jobId);
      setSelected(new Set());
      setStage(null); setPending(null); setSigned(null); setTyped(''); setPostDetails([]);
      void load();
    } catch (e) {
      setPostErr(e instanceof Error ? e.message : t('Xatolik'));
    } finally { setPosting(false); postingRef.current = false; }
  };

  const cancelJob = async () => {
    if (!job || !jobRunning) return;
    const ok = await confirm({
      title: t('Yuborishni to‘xtatasizmi?'),
      description: t('Partiya keyingi ishdan oldin to‘xtaydi. Allaqachon sudga ketgan da‘volar qaytarilmaydi; yuborilmay qolganlari ro‘yxatda qoladi.'),
      confirmLabel: t('To‘xtatish'),
      danger: true,
    });
    if (!ok) return;
    try { await fetch(`/api/jobs/${job.id}`, { method: 'POST' }); } catch { /* poller baribir ko'radi */ }
    setJob((j) => (j ? { ...j, message: t('To‘xtatish so‘raldi — joriy ish tugagach to‘xtaydi') } : j));
  };

  // ── render ────────────────────────────────────────────────────────────────
  const firmOpts = [
    { value: 'all', label: t('Hamma firma') },
    ...firmList.map((f) => ({ value: String(f.firmId), label: f.firmName, hint: eligibleByFirm.get(f.firmId) ? `${n(eligibleByFirm.get(f.firmId)!)} ${t('tayyor')}` : undefined })),
  ];
  const counts = data?.counts;
  const blockerChips = BLOCKER_ORDER.filter((b) => (counts?.byBlocker?.[b] ?? 0) > 0);
  const agoLabel = (iso: string | null) => {
    if (!iso) return null;
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (!Number.isFinite(m)) return null;
    if (m < 1) return t('hozirgina');
    if (m < 60) return `${n(m)} ${t('daq. oldin')}`;
    if (m < 1440) return `${n(Math.floor(m / 60))} ${t('soat oldin')}`;
    return fmtDate(iso);
  };

  const updatedAt = lastLoaded ? lastLoaded.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null;

  // Yagona «Ketmoqda» strip — HeaderShell.running. Barcha partiya turlari (send/draft/real) shu
  // yerdan chiqadi; onCancel faqat send'da (draft/real'ni bu tabdan to'xtatib bo'lmaydi).
  const runningStrip = activeJob ? {
    firmName: firmName(activeJob.firmId),
    kindLabel: JOB_KIND_LABEL[activeJob.kind],
    progress: activeJob.progress,
    total: activeJob.total,
    onCancel: activeJob.kind === 'send' ? cancelJob : undefined,
  } : null;

  // HeaderShell notice — ustuvorlik: server ruxsati → umumiy pauza → firma attestatsiyasi eskirdi.
  const headerNotice: { tone: 'err' | 'warn' | 'ok'; text: string; action?: { label: string; onClick: () => void } } | null = !gate ? null
    : !gate.envAllowed ? { tone: 'err', text: t('Server ruxsati o‘chiq — texnik operatorga aytish kerak') }
    : gate.globalPaused ? { tone: 'warn', text: t('Yuborish pauzada — ochish uchun tugmani bosing'), action: { label: t('Pauzani ochish'), onClick: togglePause } }
    : !attestFresh ? { tone: 'warn', text: t('E-IMZO tasdig‘i eskirgan — yuborishdan oldin qayta imzolang') }
    : null;

  // Firma navbati qatorlari — «N tayyor» chip + optional pulsing «ketmoqda M/N» + «N ni tanlash».
  const firmRows = firmList.map((f) => {
    const cnt = eligibleByFirm.get(f.firmId) ?? 0;
    const isRunning = !!activeJob && activeJob.firmId === f.firmId && activeJob.kind === 'send';
    return {
      firmId: f.firmId,
      firmName: f.firmName,
      chips: cnt > 0 ? [{ label: `${n(cnt)} ${t('tayyor')}`, tone: 'emerald' as const }] : [],
      running: isRunning
        ? { progress: activeJob!.progress, total: activeJob!.total, kindLabel: JOB_KIND_LABEL.send }
        : null,
      action: cnt > 0
        ? {
            label: `${n(cnt)} ${t('ni tanlash')}`,
            onClick: () => { changeFirm(f.firmId); selectAllEligibleForFirm(f.firmId); },
          }
        : null,
      emptyText: t('Tayyor ish yo‘q'),
      paused: pauseByFirm.get(f.firmId) === true,
    };
  });

  return (
    <section className="space-y-3" aria-labelledby={`${uid}-h`}>
      {/* ── yagona sarlavha: title/subtitle · firma+updated · stats · running · notice ── */}
      <HeaderShell
        title="Sudga o‘tkazish"
        subtitle="Tayyor qoralamalarni E-IMZO bilan sudga topshirish — qaytarib bo‘lmaydi"
        firmSlot={<Dropdown value={firm ? String(firm) : 'all'} options={firmOpts} onChange={(v) => changeFirm(v === 'all' ? null : Number(v))} />}
        updatedAt={updatedAt}
        primary={selected.size > 0
          ? {
              label: `${t('Tanlanganlarni yuborish')} (${n(selected.size)})`,
              tone: 'rose',
              onClick: () => startSend(false),
              disabled: !!bulkReason,
              title: bulkReason ?? undefined,
            }
          : {
              label: t('Tanlanganlarni yuborish'),
              tone: 'rose',
              onClick: () => { /* disabled — hech narsa qilmaydi */ },
              disabled: true,
              title: t('Ro‘yxatdan tanlang'),
            }
        }
        secondary={[
          {
            label: t('Sinov: 1 ta yuborish'),
            onClick: () => startSend(true),
            disabled: !!blockReason || !testRow,
            title: testRow ? `${t('Sinov uchun')}: ${testRow.clientName ?? testRow.pinfl ?? ''}` : (blockReason ?? undefined),
          },
          {
            label: t('Tayyorlarni belgilash'),
            onClick: selectAllEligible,
            disabled: eligibleRows.length === 0,
            title: eligibleRows.length === 0 ? t('Belgilash uchun avval firmani tanlang') : undefined,
          },
        ]}
        stats={[
          { key: 'draft', label: t('Qoralama'), value: counts?.total ?? 0, tone: 'slate' },
          { key: 'ready', label: t('Tayyor'), value: counts?.eligible ?? 0, tone: 'emerald', hint: t('Hozir yuborishga mumkin') },
          { key: 'block', label: t('To‘siq'), value: Math.max(0, (counts?.total ?? 0) - (counts?.eligible ?? 0)), tone: 'amber', hint: t('Boji to‘lanmagan / yetkazilmagan / eski paket / portalda CREATED emas') },
          { key: 'sent', label: t('Sudda'), value: sentCount, tone: 'indigo' },
        ]}
        running={runningStrip}
        notice={headerNotice}
      />

      {/* ── Batafsil (jarayon + huquqiy xavf) — subtitle ostidagi kichik «kerak bo'lsa oching» ── */}
      <details className="group rounded-xl border border-line bg-surface-2/40 open:bg-surface">
        <summary className="cursor-pointer list-none px-3 py-2 text-[12px] font-medium text-muted marker:hidden hover:text-fg">
          <span className="inline-flex items-center gap-1.5">
            <svg className="h-3 w-3 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
            {t('Batafsil — jarayon va huquqiy xavf')}
          </span>
        </summary>
        <div className="space-y-3 border-t border-line px-3 py-3 text-[12.5px] leading-relaxed">
          <p className="text-muted">{t('ADOLAT’da allaqachon saqlangan da‘vo qoralamalari («Murojaatlarim» ro‘yxati) shu yerdan API orqali sudga topshiriladi. Tizim har bir ishni yuborishdan oldin qayta tekshiradi va faqat firma E-IMZO kaliti bilan tasdiqlangandan keyin yuboradi. Sudga ketgan da‘voni tizim orqali qaytarib olib bo‘lmaydi.')}</p>
          <ol className="grid gap-2 sm:grid-cols-3" aria-label={t('Qadamlar')}>
            <li className="rounded-lg border border-line bg-surface px-3 py-2"><span className="font-semibold text-teal-700 dark:text-teal-300">1. {t('Qoralama tayyor')}</span> <span className="block text-[11.5px] text-muted">{t('ADOLAT «Murojaatlarim»da saqlangan da‘vo')}</span></li>
            <li className="rounded-lg border border-line bg-surface px-3 py-2"><span className="font-semibold text-emerald-700 dark:text-emerald-300">2. {t('Tekshiruv')}</span> <span className="block text-[11.5px] text-muted">{t('boji to‘langan · talabnoma yetkazilgan · paket yangi · portalda')} CREATED</span></li>
            <li className="rounded-lg border border-line bg-surface px-3 py-2"><span className="font-semibold text-rose-700 dark:text-rose-300">3. {t('E-IMZO bilan sudga yuborish')}</span> <span className="block text-[11.5px] text-muted">{t('qaytarib bo‘lmaydi')}</span></li>
          </ol>
          <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-2.5" role="note">
            <span className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"><IcoWarn cls="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-amber-800 dark:text-amber-200">{t('Huquqiy xavf: davlat boji imtiyozi (8-modda)')}</div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-amber-900/85 dark:text-amber-100/85">
                {t('Tizim saqlagan barcha da‘volarda «Davlat boji to‘g‘risida»gi Qonun 8-moddasi bo‘yicha imtiyoz tanlangan va to‘lov kvitansiyalari ro‘yxati bo‘sh')} <code className="whitespace-nowrap rounded bg-amber-500/15 px-1 font-mono text-[11px]">receipts: []</code>.{' '}
                {t('Bu imtiyoz MFO da‘vogarga tegishli bo‘lmasligi mumkin — sud da‘voni «boji to‘lanmagan» deb qaytarishi mumkin. Firma yuristi bilan kelishing va avval «Sinov: 1 ta yuborish» bilan bitta ishni yuborib, sud qabul qilganini tekshiring.')}
              </p>
            </div>
          </div>
        </div>
      </details>

      {/* ── firma navbati: firma nomi · N tayyor · optional ketmoqda · N ni tanlash ── */}
      <FirmQueue
        title="Firmalar bo‘yicha tayyor"
        rows={firmRows}
        empty="Firma yo‘q"
      />

      {pauseErr && <div className="text-[12px] font-medium text-rose-600 dark:text-rose-300" role="alert">{pauseErr}</div>}

      {/* ── ro'yxat (jadval + filtr chiplari) ─────────────────────────────── */}
      <div className="card p-4">
        {/* toolbar: qidirish + tanlangan sanog'i + yangilash */}
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor={`${uid}-q`} className="mb-1 block text-[11px] font-medium text-muted">{t('Qidirish')}</label>
            <input
              id={`${uid}-q`}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('F.I.O, PINFL yoki ADOLAT ID')}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none transition-colors placeholder:text-muted/60 hover:border-brand-500/60 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            />
          </div>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 text-[12px]" aria-live="polite">
              <span className="font-semibold tabular-nums">{t('Tanlangan')}: {n(selected.size)}<span className="text-muted">/{MAX_SEND}</span></span>
              <button type="button" onClick={() => setSelected(new Set())} className="rounded px-1 font-medium text-muted underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-500/30">{t('Tozalash')}</button>
            </div>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            aria-label={t('Yangilash')}
            title={t('Yangilash')}
            className="ml-auto grid h-10 w-10 place-items-center rounded-xl border border-line text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50"
          >
            <IcoRefresh spin={refreshing} />
          </button>
        </div>

        {/* holatlar */}
        {loading && !data ? (
          <div className="space-y-2" aria-busy="true" aria-label={t('Yuklanmoqda')}>
            <div className="flex gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-28 rounded-lg" />)}</div>
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : !data ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-[12px] font-medium text-rose-600 dark:text-rose-300" role="alert">
            <span>{error ?? t('Yuklab boʻlmadi')}</span>
            <button type="button" onClick={() => void load()} className="rounded border border-line px-2 py-0.5 text-muted hover:border-brand-500/40">{t('Qayta urinish')}</button>
          </div>
        ) : (
          <div className={refreshing ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
            {error && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" role="alert">
                <span>{t('Yangilanmadi')} ({error}) — {t('eski maʼlumot koʻrsatilyapti.')}</span>
                <button type="button" onClick={() => void load()} className="rounded border border-line px-1.5 py-0.5 hover:border-amber-500/50">{t('Qayta')}</button>
              </div>
            )}

            {/* Terminal (tugagan) partiya paneli — dismiss bilan; RUNNING holat HeaderShell.running'da ko'rsatiladi. */}
            {job && TERMINAL.has(job.status) && (
              <JobPanel
                job={job}
                onDismiss={() => { dismissed.current.add(job.id); setJob(null); }}
              />
            )}

            {data.rows.length === 0 ? (
              <div className="grid place-items-center rounded-xl border border-dashed border-line px-4 py-10 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted"><IcoSend /></div>
                <div className="mt-3 text-sm font-semibold">{t('Sudga o‘tkazish uchun saqlangan qoralama yo‘q')}</div>
                <p className="mt-1 max-w-md text-[12px] text-muted">{t('Avval «Qoralama (1 qadam)» tabida tayyor ishlardan ADOLAT qoralamasi tayyorlang — saqlangan qoralamalar shu yerda paydo bo‘ladi.')}</p>
                <Link
                  href={`/sud?tab=qoralama${firm ? `&firm=${firm}` : ''}`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-brand-600 outline-none transition-colors hover:border-brand-500/40 hover:bg-brand-500/5 focus-visible:ring-2 focus-visible:ring-brand-500/30 dark:text-brand-400"
                >
                  {t('Qoralama (1 qadam)')} →
                </Link>
              </div>
            ) : (
              <>
                {/* sonlar + filtr chiplari */}
                <div className="mb-3 flex flex-wrap items-center gap-1.5 overflow-x-clip" role="group" aria-label={t('Filtr')}>
                  <FilterChip on={view === 'all'} tone="slate" onClick={() => setView('all')} label={t('Hammasi')} count={counts!.total} />
                  <FilterChip on={view === 'eligible'} tone="emerald" onClick={() => setView('eligible')} label={t('Yuborishga tayyor')} count={counts!.eligible} />
                  {counts!.total - counts!.eligible > 0 && (
                    <FilterChip on={view === 'blocked'} tone="rose" onClick={() => setView('blocked')} label={t('To‘siq bor')} count={counts!.total - counts!.eligible} />
                  )}
                  {resultCount > 0 && (
                    <FilterChip on={view === 'result'} tone="indigo" onClick={() => setView('result')} label={t('Yuborish natijasi')} count={resultCount} />
                  )}
                  {blockerChips.length > 0 && <span className="mx-1 h-4 w-px bg-line" aria-hidden />}
                  {blockerChips.map((b) => (
                    <FilterChip
                      key={b}
                      on={view === `b:${b}`}
                      tone={BLOCKER_INFO[b].tone}
                      onClick={() => setView(view === `b:${b}` ? 'all' : `b:${b}`)}
                      label={t(BLOCKER_INFO[b].label)}
                      count={counts!.byBlocker[b] ?? 0}
                      tip={t(BLOCKER_INFO[b].hint)}
                    />
                  ))}
                </div>

                {/* jadval */}
                {filtered.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-[12px] text-muted">{t('Bu filtrda ish yo‘q')}</div>
                ) : (
                  <div role="table" aria-label={t('Saqlangan da‘volar')} className="overflow-x-clip rounded-xl border border-line">
                    <div role="rowgroup">
                      <div role="row" className="hidden items-center gap-3 border-b border-line bg-surface-2/60 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted lg:grid lg:grid-cols-[1.5rem_minmax(0,1.7fr)_minmax(0,1.3fr)_minmax(0,1.05fr)_6.5rem_minmax(0,1.6fr)]">
                        <span role="columnheader">
                          <input
                            ref={headBox}
                            type="checkbox"
                            checked={pageAllOn}
                            onChange={togglePage}
                            disabled={pageSelectable.length === 0}
                            aria-label={t('Sahifadagi tayyorlarni belgilash')}
                            className="h-4 w-4 cursor-pointer rounded border-line accent-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        </span>
                        <span role="columnheader">{t('Mijoz')}</span>
                        <span role="columnheader">{t('Sud · ADOLAT ID')}</span>
                        <span role="columnheader">{t('Qoralama · portal')}</span>
                        <span role="columnheader">{t('Boji · xat')}</span>
                        <span role="columnheader">{t('Holat')}</span>
                      </div>
                    </div>
                    <div role="rowgroup" className="divide-y divide-line">
                      {pageRows.map((r) => (
                        <SendRowItem
                          key={r.caseId}
                          r={r}
                          showFirm={firm === null}
                          canSelect={selectable(r)}
                          checked={selected.has(r.caseId)}
                          atCap={selected.size >= MAX_SEND}
                          noFirm={firm === null}
                          onToggle={() => toggle(r.caseId)}
                          agoLabel={agoLabel}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {pages > 1 && (
                  <nav className="mt-3 flex items-center justify-between gap-2 text-[12px]" aria-label={t('Sahifalar')}>
                    <button type="button" onClick={() => setPage(Math.max(0, pageSafe - 1))} disabled={pageSafe === 0} className="rounded-lg border border-line px-3 py-1.5 font-medium outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-40">← {t('Oldingi')}</button>
                    <span className="tabular-nums text-muted">{n(pageSafe * PAGE + 1)}–{n(Math.min(filtered.length, (pageSafe + 1) * PAGE))} / {n(filtered.length)}</span>
                    <button type="button" onClick={() => setPage(Math.min(pages - 1, pageSafe + 1))} disabled={pageSafe >= pages - 1} className="rounded-lg border border-line px-3 py-1.5 font-medium outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-40">{t('Keyingi')} →</button>
                  </nav>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── 1) E-IMZO ────────────────────────────────────────────────────────── */}
      {pending && stage === 'sign' && (
        <KeyPicker
          open
          onClose={closeFlow}
          firm={{ firmId: pending.firmId, firmName: pending.firmName, stir: pending.stir ?? null }}
          provider="CABINET"
          endpoint="/konveyer/court-sign"
          title={t('Sudga yuborish — E-IMZO tasdig‘i')}
          confirmLabel={t('Imzolash va davom etish')}
          // KeyPicker summary'ni o'z ramkasiga o'raydi — bu yerda faqat matn.
          summary={
            <>
              <b>{pending.firmName}: {n(pending.caseIds.length)} {t('ta da‘vo sudga yuboriladi.')}</b>{' '}
              {t('Firma kaliti bilan imzolang — keyingi qadamda yana bir bor yozma tasdiq so‘raladi.')}
            </>
          }
          onSuccess={(d: { keyCn?: string | null; verified?: boolean } | undefined) => {
            setSigned({ at: Date.now(), keyCn: d?.keyCn ?? null, verified: d?.verified });
            setNow(Date.now());
            setStage('confirm');
            void load(); // attestatsiya pill'i yangilansin
          }}
        />
      )}

      {/* ── 2) «YUBORISH» — oxirgi tasdiq ───────────────────────────────────────── */}
      {pending && stage === 'confirm' && (
        <Modal
          open
          onClose={closeFlow}
          size="md"
          title={pending.test ? t('Sinov yuborish — oxirgi tasdiq') : t('Sudga yuborish — oxirgi tasdiq')}
          footer={
            <>
              <button type="button" onClick={closeFlow} disabled={posting} className="rounded-lg border border-line px-3.5 py-1.5 text-xs font-medium text-muted outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-40">{t('Bekor')}</button>
              {signStale ? (
                <button type="button" onClick={() => { setPostErr(null); setStage('sign'); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white outline-none hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40">{t('Qayta imzolash')}</button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!typedOk || posting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-colors hover:bg-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {posting ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> : <IcoSend />}
                  {t('Yuborishni tasdiqlash')} ({n(pending.caseIds.length)})
                </button>
              )}
            </>
          }
        >
          <div className="space-y-3 text-[13px]">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
              <dt className="text-muted">{t('Firma')}</dt><dd className="font-semibold">{pending.firmName}</dd>
              <dt className="text-muted">{t('Ishlar')}</dt><dd className="font-semibold tabular-nums">{n(pending.caseIds.length)} {t('ta')}{pending.test && <span className="ml-1.5 rounded bg-brand-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-700 dark:text-brand-300">{t('sinov')}</span>}</dd>
              <dt className="text-muted">E-IMZO</dt>
              <dd className={signStale ? 'font-semibold text-rose-600 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}>
                {signStale ? t('Tasdiq eskirdi — qaytadan imzolang') : (
                  <>
                    {signed?.keyCn ? `${signed.keyCn} · ` : ''}{t('amal qiladi')}{' '}
                    <span className="tabular-nums">{Math.floor(signLeft / 60_000)}:{String(Math.floor((signLeft % 60_000) / 1000)).padStart(2, '0')}</span>
                  </>
                )}
              </dd>
            </dl>
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted">{t('Mijozlar')}</div>
              <ul className="space-y-0.5 text-[12.5px]">
                {pending.names.slice(0, 5).map((nm, i) => <li key={i} className="truncate">• {nm}</li>)}
                {pending.names.length > 5 && <li className="text-muted">{t('va yana')} {n(pending.names.length - 5)} {t('ta')}</li>}
              </ul>
            </div>
            <div className="flex gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-[12.5px] text-rose-700 dark:text-rose-300" role="note">
              <span className="mt-0.5 shrink-0"><IcoWarn cls="h-4 w-4" /></span>
              <span>
                <b>{t('Qaytarib bo‘lmaydi.')}</b> {t('Da‘vo sudga ro‘yxatga olinadi va uni tizim orqali qaytarib olib bo‘lmaydi. Barcha saqlangan da‘volarda 8-modda boji imtiyozi bor — sud qaytarishi mumkin.')}
                {!pending.test && <> {t('Birinchi marta bo‘lsa, avval «Sinov: 1 ta yuborish» qiling.')}</>}
              </span>
            </div>
            <div>
              <label htmlFor={`${uid}-typed`} className="mb-1 block text-[12px] font-medium">
                {t('Tasdiqlash uchun quyidagi so‘zni yozing:')} <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] font-bold">{CONFIRM_WORD}</code>
              </label>
              <input
                id={`${uid}-typed`}
                ref={typedRef}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && typedOk && !signStale) { e.preventDefault(); void submit(); } }}
                disabled={posting || signStale}
                aria-invalid={typed.length > 0 && !typedOk}
                className="h-10 w-full rounded-xl border border-line bg-surface px-3 font-mono text-sm uppercase tracking-widest outline-none transition-colors focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-50"
              />
            </div>
            {signed?.verified === false && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300" role="note">
                {t('Imzo serverda to‘liq tekshirilmadi — server yuborishni rad etishi mumkin. Rad etsa, qaytadan imzolang.')}
              </div>
            )}
            {postErr && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300" role="alert">
                <div className="font-medium">{postErr}</div>
                {postDetails.length > 0 && (
                  <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[11.5px]">
                    {postDetails.slice(0, 20).map((l, i) => <li key={i} className="break-words">• {l}</li>)}
                    {postDetails.length > 20 && <li className="text-muted">{t('va yana')} {n(postDetails.length - 20)} {t('ta')}</li>}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

// ── filtr chipi ───────────────────────────────────────────────────────────────
function FilterChip({ on, tone, onClick, label, count, tip }: { on: boolean; tone: Tone; onClick: () => void; label: string; count: number; tip?: string }) {
  const btn = (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/40 ${on ? CHIP_ON[tone] : `${CHIP[tone]} hover:brightness-95`}`}
    >
      {label}
      <span className={`tabular-nums ${on ? 'opacity-90' : 'opacity-75'}`}>{count.toLocaleString('ru-RU')}</span>
    </button>
  );
  return tip ? <Tip label={tip} side="bottom">{btn}</Tip> : btn;
}

// ── bitta qator ───────────────────────────────────────────────────────────────
function SendRowItem({ r, showFirm, canSelect, checked, atCap, noFirm, onToggle, agoLabel }: {
  r: SendRow; showFirm: boolean; canSelect: boolean; checked: boolean; atCap: boolean; noFirm: boolean;
  onToggle: () => void; agoLabel: (iso: string | null) => string | null;
}) {
  const t = useT();
  const disabled = !canSelect || (atCap && !checked);
  const whyNot = !r.eligible
    ? t('Yuborib bo‘lmaydi — «Holat» ustunidagi to‘siqlarga qarang')
    : noFirm ? t('Belgilash uchun avval firmani tanlang')
      : atCap && !checked ? t('Bir partiyada eng ko‘pi 100 ta') : undefined;
  // Holat ustunida takror bo'lmasin: yuborish holati chipi bor bo'lsa, xuddi shu ma'noli to'siq chiqmaydi.
  const shown = r.blockers.filter((b) => !(
    (b === 'SENDING' && r.send?.state === 'SENDING')
    || (b === 'CHECK' && r.send?.state === 'CHECK')
    || (b === 'SUBMITTED' && r.send?.state === 'SENT')
  ));
  const ps = r.portalStatus;
  const portalLabel = ps ? (PORTAL_STATUS_UZ[ps] ?? ps) : null;
  const portalTip = `${ps ? `${t('Portal holati')}: ${ps}` : t('Portal holati bazada yo‘q — yuborishdan oldin jonli tekshiriladi')}${r.portalCheckedAt ? ` · ${t('tekshirilgan')} ${fmtDate(r.portalCheckedAt)}` : ''}`;
  const name = r.clientName || '—';

  return (
    <div
      role="row"
      className={`grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-3 py-2.5 transition-colors lg:grid-cols-[1.5rem_minmax(0,1.7fr)_minmax(0,1.3fr)_minmax(0,1.05fr)_6.5rem_minmax(0,1.6fr)] lg:items-center ${checked ? 'bg-brand-500/[0.06]' : 'hover:bg-surface-2/50'}`}
    >
      <div role="cell" className="row-span-5 pt-0.5 lg:row-span-1 lg:pt-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          aria-label={`${t('Tanlash')}: ${name}`}
          title={whyNot}
          className="h-4 w-4 cursor-pointer rounded border-line accent-brand-600 disabled:cursor-not-allowed disabled:opacity-35"
        />
      </div>

      <div role="cell" className="min-w-0">
        <div className="truncate text-[13px] font-semibold" title={name}>{name}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          <span className="font-mono tabular-nums">{r.pinfl ?? '—'}</span>
          {showFirm && <span className="rounded bg-surface-2 px-1 font-medium">{r.firmName}</span>}
          {r.totalDebt != null && <span className="tabular-nums">{t('Qarz')}: {r.totalDebt.toLocaleString('ru-RU')}</span>}
        </div>
      </div>

      <div role="cell" className="min-w-0 text-[12px]">
        <div className="truncate" title={r.courtName ?? undefined}>{r.courtName ?? <span className="text-muted">{t('Sud noma‘lum')}</span>}</div>
        <div className="truncate font-mono text-[10.5px] text-muted" title={`ADOLAT ID: ${r.cabinetCaseId}`}>{r.cabinetCaseId}</div>
      </div>

      <div role="cell" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] lg:block">
        <div className="tabular-nums" title={t('Qoralama saqlangan vaqt')}>{fmtDate(r.suitReadyAt)}</div>
        <div className="lg:mt-0.5">
          <Chip tone={!ps ? 'slate' : ps === 'CREATED' ? 'teal' : 'amber'} dot tip={portalTip}>
            {portalLabel ? t(portalLabel) : t('noma‘lum')}
          </Chip>
        </div>
      </div>

      <div role="cell" className="flex flex-wrap gap-1 lg:flex-col lg:items-start">
        <MiniTile ok={r.bojiPaid} label={t('Boji')} tip={r.bojiPaid ? t('Davlat boji to‘langan') : t('Davlat boji hali to‘lanmagan')} />
        <MiniTile ok={r.delivered} label={t('Yetkazildi')} tip={r.delivered ? t('Talabnoma yetkazilgani isbotlangan') : t('Talabnoma yetkazilgani isbotlanmagan')} />
      </div>

      <div role="cell" className="flex min-w-0 flex-wrap items-center gap-1">
        {r.send && (
          <Chip
            tone={SEND_INFO[r.send.state].tone}
            spin={r.send.state === 'SENDING'}
            dot={r.send.state !== 'SENDING'}
            tip={
              <>
                {t(SEND_INFO[r.send.state].label)} · {agoLabel(r.send.at) ?? fmtDate(r.send.at)}
                {r.send.error && <><br />{r.send.error}</>}
                {r.send.state === 'CHECK' && <><br />{t(BLOCKER_INFO.CHECK.hint)}</>}
              </>
            }
          >
            {t(SEND_INFO[r.send.state].label)}
          </Chip>
        )}
        {/* Oldingi urinish FAILED bo'lsa ham server uni yana yaroqli deb bilsa — qayta yuborsa bo'ladi. */}
        {r.eligible && shown.length === 0 && r.send?.state !== 'SENDING' && <Chip tone="emerald" dot>{t('Yuborishga tayyor')}</Chip>}
        {shown.map((b) => (
          <Chip key={b} tone={BLOCKER_INFO[b]?.tone ?? 'slate'} tip={BLOCKER_INFO[b] ? t(BLOCKER_INFO[b].hint) : b}>
            {BLOCKER_INFO[b] ? t(BLOCKER_INFO[b].label) : b}
          </Chip>
        ))}
      </div>
    </div>
  );
}

// ── tugagan partiya paneli ────────────────────────────────────────────────────
// 2026-09-20: faqat TERMINAL (DONE/CANCELED/FAILED) holat uchun — RUNNING holat HeaderShell.running
// yagona stripini ishlatadi (takror pulsing chiziq yo'q).
function JobPanel({ job, onDismiss }: {
  job: { id: number; firmName: string; status: string; progress: number; total: number; message?: string | null; pollError?: string; test?: boolean; note?: string };
  onDismiss: () => void;
}) {
  const t = useT();
  const pct = job.total > 0 ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0;
  const tone = job.status === 'DONE' ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
    : job.status === 'CANCELED' ? 'border-amber-500/35 bg-amber-500/[0.06]'
      : 'border-rose-500/30 bg-rose-500/[0.05]';
  const head = job.status === 'DONE' ? t('Partiya tugadi')
    : job.status === 'CANCELED' ? t('Partiya to‘xtatildi')
      : t('Partiya xato bilan tugadi');
  return (
    <div className={`mb-3 rounded-xl border px-3 py-2.5 ${tone}`} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold">{head}</span>
        <span className="text-[12px] text-muted">· {job.firmName} · #{job.id}{job.test ? ` · ${t('sinov')}` : ''}</span>
        <span className="ml-auto text-[12px] font-semibold tabular-nums">{job.progress.toLocaleString('ru-RU')}/{job.total.toLocaleString('ru-RU')}</span>
        <button type="button" onClick={onDismiss} aria-label={t('Yopish')} className="grid h-6 w-6 place-items-center rounded-md text-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className={`h-full rounded-full transition-[width] duration-500 ${job.status === 'DONE' ? 'bg-emerald-500' : job.status === 'CANCELED' ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: '100%' }} />
      </div>
      {job.message && <div className="mt-1.5 text-[12px]">{job.message}</div>}
      {job.note && <div className="mt-1 text-[11.5px] text-amber-700 dark:text-amber-300">{job.note}</div>}
      {job.pollError && <div className="mt-1 text-[11.5px] text-amber-700 dark:text-amber-300">{job.pollError}</div>}
      {job.status === 'DONE' && job.test && (
        <div className="mt-1.5 text-[11.5px] text-muted">{t('Sinov yuborildi. Portalda holati «Roʻyxatga olingan»ga o‘tganini va sud qaytarmaganini tekshiring — keyin qolganlarini yuboring.')}</div>
      )}
    </div>
  );
}
