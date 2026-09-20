'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, useConfirm } from '@/ui';
import { useT } from '@/lib/i18n/client';
import { Dropdown } from './Dropdown';
// 2026-09-20: DraftAutoPanel olib tashlandi. Uning ma'lumot manbasi (GET /konveyer/court-draft-auto)
// endi shu fayl ichida `useDraftAuto` yordami bilan o'qiladi va HeaderShell.running / notice
// hamda FirmQueue rows uchun manba bo'ladi. Yagona joyda «Ketmoqda» strip.
import { HeaderShell, type Tone } from './_shared/HeaderShell';
import { FirmQueue, type FirmRow as FirmQueueRow } from './_shared/FirmQueue';
import { CaseDocs } from './CaseDocs';
import { KeyPicker } from './KeyPicker';
// Partiya hajmi — yagona manba (server ham shu qiymat bilan cheklaydi).
import { MAX_COURT_BATCH, MAX_ZIP_BATCH } from '@/lib/court-batch';
// Tab sonlari — server bilan YAGONA qoida (court-counts.ts). Ilgari bu yerda o'z nusxasi
// bor edi va ikkisi bir-biridan uzoqlashib ketishi mumkin edi.
import { tallyClientCounts } from '@/lib/court-counts';

// ── types (mirror src/lib/court-ready.ts) ────────────────────────────────────
interface Missing { talabnoma: number; scan: number; oferta: number; receipt: number; boji: number }
interface FirmDocsStatus { complete: boolean; missing: string[]; present: string[] }
// `submittedExternal` — `submitted` ICHIDAN: yurist ADOLAT'da qo'lda kiritgan da'volar.
interface FirmReadiness { firmId: number; firmName: string; total: number; ready: number; exported: number; submitted: number; submittedExternal: number; draftReady: number; queued: number; sendable: number; /** sendable ∩ boji to'langan — REAL yuborish faqat shularni oladi */ sendablePaid: number; missing: Missing; almost: Missing; docs: FirmDocsStatus }
// Sud paketiga qo'shiladigan firma hujjatlari — 3 tasi ham kerak.
const FIRM_DOCS_ALL = ['guvohnoma', 'ishonchnoma', 'shartnoma'];
export interface CourtOverall { total: number; ready: number; exported: number; submitted: number; submittedExternal: number; draftReady: number; queued: number; sendable: number; missing: Missing; almost: Missing }
type Overall = CourtOverall;
// 2026-09-19 (/sud 3-tab): `statusBoard`/`returns` endi ishlatilmaydi — o'lik «stat»/«returns»
// tablari olib tashlandi (qaytganlar — alohida «Qaytganlar» tabi). court-ready route ularni hali
// qaytaradi, shuning uchun maydonlar ixtiyoriy (e'tiborsiz) qoldi.
export interface CourtData { snapshotId?: number; readiness: { firms: FirmReadiness[]; overall: Overall }; statusBoard?: unknown; returns?: unknown }
type Data = CourtData;

type ReadyFilter = 'all' | 'sendable' | 'queued' | 'draftReady' | 'ready' | 'exported' | 'submitted' | 'notready';
interface ClientRow {
  caseId: number; clientName: string | null; pinfl: string | null; stage: string; stageLabel: string;
  talabnoma: boolean; talabnomaDelivered: boolean; receipt: boolean; scan: boolean; oferta: boolean; boji: boolean;
  ready: boolean; exported: boolean; submitted: boolean; submittedExternal?: boolean; draftReady?: boolean; queued: boolean; sendable: boolean; totalDebt: string; daysLeft: number | null;
  receiptNumber: string | null;
  // Sud — «Batafsil» ichidagi filtr uchun (firma ishlari bir necha sudga bo'lingan bo'lishi mumkin).
  courtId: number | null; courtName: string | null; courtEnabled: boolean;
}
interface ClientCounts { all: number; sendable: number; queued: number; draftReady: number; ready: number; exported: number; submitted: number; notready: number }
interface ClientPage { rows: ClientRow[]; total: number; page: number; pageSize: number; pages: number; counts: ClientCounts; error?: string }

// `asked` — operator nechta so'ragani (server topgani `total` dan kam bo'lishi mumkin).
type JobState = { jobId: number; status: string; progress: number; total: number; error?: string; message?: string; type?: string; asked?: number;
  /** Bugunga sig'magani (sud kunlik limiti) — navbatga qo'yildi, yo'qolmadi. */
  deferred?: number };

const n = (x: number) => x.toLocaleString('ru-RU');
const sum = (v: string) => Number(v).toLocaleString('ru-RU');

/**
 * JSON kutilgan so'rov uchun yagona o'quvchi.
 *
 * NEGA kerak: sessiya tugaganda server login sahifasiga yo'naltiradi va brauzer uni
 * KUZATIB borib **200 + HTML** oladi. Ya'ni `res.ok` true bo'ladi, `res.json()` esa
 * «Unexpected token '<', "<!DOCTYPE"... is not valid JSON» deb yiqiladi — operator
 * uchun umuman tushunarsiz xato. Endi content-type tekshiriladi va aniq sabab yoziladi.
 */
async function getJson<T = any>(url: string, init?: RequestInit, t: (s: string) => string = (s) => s): Promise<T> {
  const res = await fetch(url, init);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (res.redirected || res.url.includes('/login')) {
      throw new Error(t('Sessiya tugagan — sahifani yangilab, qaytadan kiring.'));
    }
    throw new Error(`${t('Server JSON qaytarmadi')} (${res.status}). ${t('Sahifani yangilab ko‘ring.')}`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error((data as any)?.error || `${t('Server xatosi')} (${res.status})`);
  return data as T;
}

// ── shared little bits ───────────────────────────────────────────────────────
const RING_STROKE: Record<'high' | 'mid' | 'low', string> = { high: '#10b981', mid: '#f59e0b', low: '#f43f5e' };
const ringTone = (pct: number) => (pct >= 80 ? 'high' : pct >= 40 ? 'mid' : 'low');

// Signature visual: readiness as a stroke-animated inline-SVG ring. The app's global
// prefers-reduced-motion rule zeroes the transition for free.
function ReadinessRing({ pct, size = 48, sw = 5 }: { pct: number; size?: number; sw?: number }) {
  const t = useT();
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const big = size >= 88;
  return (
    <span role="img" aria-label={`${p}% ${t('tayyor')}`} className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING_STROKE[ringTone(p)]} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className={`absolute font-bold tabular-nums ${big ? 'text-2xl' : 'text-[11px]'}`}>{p}<span className={big ? 'text-sm' : 'text-[8px]'}>%</span></span>
    </span>
  );
}

// Chiroyli hover tooltip (native `title` o'rniga) — element ustiga borilganda tepadan (yoki pastdan)
// yumshoq chiqadi. CSS-only (group-hover), qo'shimcha JS yo'q. `shrink-0` flex qatorda joyni saqlaydi.
function Tip({ label, children, side = 'top', className }: { label: string; children: React.ReactNode; side?: 'top' | 'bottom'; className?: string }) {
  return (
    <span className={`group/tip relative inline-flex ${className ?? ''}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 scale-95 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg ring-1 ring-black/10 transition-[opacity,transform] duration-150 group-hover/tip:scale-100 group-hover/tip:opacity-100 dark:bg-slate-700 ${side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}`}
      >
        {label}
        <span className={`absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-slate-900 dark:bg-slate-700 ${side === 'bottom' ? '-top-0.5' : '-bottom-0.5'}`} aria-hidden />
      </span>
    </span>
  );
}

// A doc-present/absent tile. `optional` marks a doc that is NOT a court-readiness gate (boji) — it
// renders with a dashed, muted look and an «shart emas» tooltip so a dash there never reads as a
// blocking «yetishmayapti». Court gate = talabnoma + skan + oferta (see court-ready.ts flagsFor).
function DocTile({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  const t = useT();
  const cls = ok
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : optional ? 'border border-dashed border-line bg-transparent text-muted/40' : 'bg-surface-2 text-muted/60';
  const tip = optional ? `${t(label)}: ${ok ? t('bor') : t("yo'q")} ${t("— ma'lumot uchun (sud uchun shart emas)")}` : `${t(label)}: ${ok ? t('bor') : t("yo'q")}`;
  return (
    <Tip label={tip}>
      <span className={`grid h-6 w-6 place-items-center rounded-md ${cls}`} aria-label={tip}>
        {ok
          ? <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>
          : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M6 12h12" /></svg>}
      </span>
    </Tip>
  );
}

function DueBadge({ d }: { d: number | null }) {
  const t = useT();
  if (d === null) return null;
  if (d < 0) return <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-300">{Math.abs(d)} {t('kun kechikdi')}</span>;
  if (d === 0) return <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">{t('bugun')}</span>;
  return <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">{d} {t('kun')}</span>;
}

const AVATAR = [
  'bg-sky-500/15 text-sky-600 dark:text-sky-300', 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  'bg-rose-500/15 text-rose-600 dark:text-rose-300', 'bg-teal-500/15 text-teal-600 dark:text-teal-300',
];
const avatarColor = (seed: string) => AVATAR[[...(seed || '0')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR.length];
const initials = (name: string | null) => (name || '—').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—';

const IcoBolt = () => <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /></svg>;
const IcoPlus = () => <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>;
const IcoDown = () => <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /></svg>;

// The «Chiqarish» control, driven by the PARENT-owned job (survives firm-filter/tab switches).
// `batchActive` — SHU firmada serverda allaqachon ketayotgan (yoki navbatda turgan)
// COURT_SUBMIT partiyasi. Busiz tugma har doim yoqilgan turardi: `job` faqat SHU brauzer
// boshlagan partiyani biladi, avtomat davom ettirilgani yoki boshqa oynadan boshlanganini
// EMAS. Operator bosardi, server esa 409 qaytarardi va navbatda quruq qizil «xato» chiqardi
// (2026-09-07: BRIGHT ketayotganda «Sudga yuborish (200)» yana bosilgan).
function ExportControl({ job, sendable, onStart, batchActive }: {
  job?: JobState; sendable: number; onStart: () => void;
  batchActive?: { jobId: number; status: string; queuePos: number } | null;
}) {
  const t = useT();
  const running = !!job && (job.status === 'PENDING' || job.status === 'RUNNING');
  const done = job?.status === 'DONE';
  // (progress foizi ExportControl da endi kerak emas — raqamlar qator ostidagi yagona chiziqda)
  // Qoralama (COURT_SUBMIT, suitMode) job'i fayl YARATMAYDI — unga ZIP havolasi ko'rsatilsa 404
  // beradi. Uning o'rniga runner yozgan halol hisobot ko'rsatiladi
  // («N ta qoralama tayyorlandi, M ta XATO, K ta navbatda qoldi»).
  const isSubmit = job?.type === 'COURT_SUBMIT';
  if (done && job && isSubmit) {
    const hadError = /XATO/i.test(job.message || '');
    return (
      <div className="flex flex-col items-end gap-1">
        <span className={`inline-flex min-h-9 max-w-full items-center text-balance rounded-lg border px-3 py-1.5 text-xs font-semibold leading-tight ${hadError ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}>
          {job.message || `${job.total} ${t('ta qoralama tayyorlandi')}`}
        </span>
        {/* Bugunga sig'magani JIM YO'QOLMASIN: ilgari operator «91 so'radim, 12 ketdi»
            farqini ko'rmasdi — yozuv yashil «tayyor» bo'lib turardi. */}
        {(job.deferred ?? 0) > 0 && (
          <span className="max-w-full text-balance text-[10px] leading-tight text-amber-600 dark:text-amber-400">
            {n(job.deferred!)} {t('tasi bugungi sud limitiga sig‘madi — navbatda, ertaga o‘zi ketadi')}
          </span>
        )}
        {sendable > 0 && (
          <button onClick={onStart} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30" title={`${t('Keyingi')} ${Math.min(MAX_COURT_BATCH, sendable)} ${t('ta')}`}>
            <IcoBolt /> {t('Yana')} ({Math.min(MAX_COURT_BATCH, sendable)})
          </button>
        )}
      </div>
    );
  }
  if (done && job) {
    // Keep the download AND, when the firm still has ready-not-exported cases,
    // a «Yana» button so batches of >100 aren't stuck after the first ZIP.
    return (
      <div className="flex flex-col items-end gap-1">
        <a href={`/api/export/${job.jobId}/download`} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 outline-none transition-colors hover:bg-emerald-500/15 focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-300">
          <IcoDown /> {job.total} {t('ta ZIP — yuklab olish')}
        </a>
        {sendable > 0 && (
          <button onClick={onStart} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30" title={`${t('Keyingi')} ${Math.min(MAX_COURT_BATCH, sendable)} ${t('ta')}`}>
            <IcoBolt /> {t('Yana')} ({Math.min(MAX_COURT_BATCH, sendable)})
          </button>
        )}
      </div>
    );
  }
  // Serverda partiya ketayotgan bo'lsa tugma O'CHIRILMAYDI — u «Navbatga qo'shish» ga
  // aylanadi.
  //
  // Nega: prepare-ready bir firmaga ikkinchi partiyani rad etadi (409) va bu TO'G'RI —
  // ikkita parallel partiya bir odamga ikkita da'vo ochishi mumkin. Lekin operator uchun
  // «kut, keyin qaytib kel va yana bos» degani — soatlab ekranni kuzatish. Endi ish
  // brauzerdagi yuborish navbatiga tushadi va ketayotgan partiya tugashi bilan O'ZI
  // boshlanadi (kalit ham qayta so'ralmaydi — firma bir marta imzolangan).
  const busyServer = !!batchActive;
  const serverRunning = batchActive?.status === 'RUNNING';
  const blocked = running || sendable === 0;
  return (
    // max-w — QAT'IY: bu ustunning eni tugma bo'yicha belgilanadi, ichidagi izoh matni
    // bo'yicha EMAS. Busiz uzun izoh («#248 ketmoqda — yangi partiya undan keyin
    // boshlanadi») ustunni cho'zib, firma nomi va chiplarni siqib qo'yardi.
    <div className="flex min-w-0 max-w-[12rem] shrink-0 flex-col items-end gap-1 text-right">
      <button
        onClick={onStart}
        disabled={blocked}
        aria-busy={running || serverRunning}
        className={`${ROW_BTN} bg-brand-500 text-white shadow-sm hover:bg-brand-600 focus-visible:ring-brand-500/40 disabled:opacity-40`}
        title={
          busyServer
            ? `${t('Bu firmaning partiyasi hozir')} ${serverRunning ? t('ketmoqda') : t('navbatda')} (#${batchActive!.jobId}). ${t("Yangi partiya NAVBATGA qo'shiladi va o'sha tugashi bilan o'zi boshlanadi — kalit qayta so'ralmaydi.")}`
            : sendable === 0 ? t('Qoralamaga tayyor mijoz yoʻq')
              : `${Math.min(MAX_COURT_BATCH, sendable)} ${t("ta tayyor ish uchun ADOLAT'da qoralama tayyorlash (sudga yuborilmaydi)")}`
        }
      >
        {running
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {t('Tayyorlanmoqda')}</>
          : busyServer
            ? <><IcoPlus /> {t('Navbatga qo‘shish')} {sendable > 0 ? `(${Math.min(MAX_COURT_BATCH, sendable)})` : ''}</>
            : <><IcoBolt /> {t('Qoralama tayyorlash')} {sendable > 0 ? `(${Math.min(MAX_COURT_BATCH, sendable)})` : ''}</>}
      </button>
      {/* Ketayotgan partiya haqidagi izoh ATAYIN yo'q.
          U shu yerda ham turardi, lekin ayni ma'lumot sahifaning yuqorisida — «Yuborish
          navbati» va navbat panelida — allaqachon bor edi, va ikkalasi boshqa-boshqa
          manbadan sanaganligi uchun sonlari mos kelmasdi (operator: «tepada borku, soni
          boshqasi»). Bitta haqiqat bitta joyda tursin; nima uchun tugma «Navbatga
          qo'shish»ga aylangani tugmaning o'z title'ida yozilgan. */}
      {/* Xato: worker yozgan sabab `message`da keladi (route xatosi esa `error`da). */}
      {/* Xato: FAILED holatida server sababi (`message`), yoki holat o'qilmay qolganda
          (masalan sessiya tugadi) poller yozgan `error` — u RUNNING paytida ham chiqishi
          kerak, aks holda progress jimgina qotib qolgandek ko'rinadi. */}
      {(job?.status === 'FAILED' || job?.error) && (
        <span className="max-w-full text-[11px] font-medium leading-tight text-rose-500 [overflow-wrap:anywhere]" role="alert"
          title={job?.status === 'FAILED' ? (job.message || job.error || t('Xatolik')) : job?.error}>
          {job?.status === 'FAILED' ? (job.message || job.error || t('Xatolik')) : job?.error}
        </span>
      )}
    </div>
  );
}

// ZIP eksporti — O'Z holati bilan, sudga yuborishdan MUSTAQIL.
//
// Nega alohida: ilgari ikkalasi bitta `firm:<id>` job kalitida edi. Operator ZIP bosganida
// sud tugmasi «Yuborilmoqda» bo'lib qolardi va navbat paneli jonlanardi — sudga bitta ham
// so'rov ketmagan bo'lsa ham (2026-09-07). ZIP portalga umuman tegmaydi: u faqat serverda
// PDF render qiladi, shuning uchun sud tugmasini ham bloklamasligi kerak.
// ZIP — BITTA IKONKA. Sudga yuborishdan mustaqil (o'z job kaliti: `zip:<id>`).
//
// Nega ikonka: bu ikkilamchi amal — qatordagi asosiy tugma «Sudga yuborish». ZIP matnli
// tugma bo'lganda ikkalasi bir xil og'irlikda ko'rinardi va qator kengayib ketardi.
// Ma'no yo'qolmasin uchun holat ikonkaning O'ZIDA ko'rsatiladi (halqa = progress,
// yashil = tayyor, qizil = xato), izohi esa title/aria-label da to'liq yoziladi —
// ya'ni ikonka «yalang'och» emas: sichqoncha bilan ham, skrinrider bilan ham o'qiladi.
/**
 * FIRMA QATORIDAGI AMALLAR — YAGONA BALANDLIK.
 *
 * O'lchangan holat (2026-09-08): bitta qatorda TO'RT xil balandlik bor edi —
 * ZIP ikonkasi 36px, «Batafsil» 30px, «Sudga yuborish» 28px, kichik ikonkalar 24px.
 * «Sudga yuborish» eng MUHIM amal bo'la turib eng past edi, va u «Batafsil»dan aynan
 * 2px past edi chunki unda border yo'q — `py-*` bilan balandlik ramka borligiga qarab
 * o'zgaradi. Shuning uchun balandlik endi QAT'IY (`h-9` = 36px), `py-*` emas: ramka
 * bor-yo'qligi endi hech narsani suriltirmaydi.
 *
 * 36px — bosish maydoni sifatida ham 28px dan ancha yaxshi (ideal 44px, lekin bu zich
 * admin jadvali; 36px qo'shni tugmalar orasidagi 8px bilan birga xavfsiz).
 */
const ROW_H = 'h-9';
const ROW_BTN = `inline-flex ${ROW_H} shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 disabled:cursor-not-allowed`;
const ZIP_BTN = `relative grid ${ROW_H} w-9 shrink-0 place-items-center rounded-lg border transition-colors outline-none focus-visible:ring-2`;
// ⋮ menyu ichidagi bitta amal — chapga tekislangan, ikon + yorliq (+ ixtiyoriy o'ng qism).
const MENU_ITEM = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-fg outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 disabled:opacity-50';

function ZipRing({ pct, indeterminate }: { pct: number; indeterminate?: boolean }) {
  const C = 2 * Math.PI * 15.5;
  return (
    <svg className={`absolute inset-0 h-full w-full -rotate-90 ${indeterminate ? 'animate-spin' : ''}`} viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="2" className="stroke-line" />
      <circle
        cx="18" cy="18" r="15.5" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-brand-500"
        strokeDasharray={C} strokeDashoffset={indeterminate ? C * 0.75 : C * (1 - pct / 100)}
        style={{ transition: indeterminate ? undefined : 'stroke-dashoffset .5s' }}
      />
    </svg>
  );
}

function ZipControl({ job, sendable, onStart, onCancel }: { job?: JobState; sendable: number; onStart: () => void; onCancel?: (jobId: number) => void }) {
  const t = useT();
  const running = !!job && (job.status === 'PENDING' || job.status === 'RUNNING');
  const pct = job && job.total ? Math.round((job.progress / job.total) * 100) : 0;
  // Operator so'ragan son bilan server topgani farq qilsa — AYTAMIZ. Jim farq aynan
  // «616 so'radim, 100 chiqdi» chalkashligini keltirib chiqargan edi.
  const short = job?.asked != null && job.total > 0 && job.asked > job.total ? job.asked - job.total : 0;

  // TAYYOR — yashil, bosilsa yuklab oladi. Soni ikonka ustidagi kichik nishonchada.
  if (job?.status === 'DONE' && job.jobId) {
    // ARXIVDA KIM BORLIGI SHU YERDA AYTILADI. Ilgari tugagan kartada faqat son turardi:
    // operator 100 talik ikkita arxivni olib, ular ustma-ust tushadimi va ichida kim
    // borligini ZIP'ni ochib papka nomlarini o'qimaguncha bilolmasdi (2026-09-08).
    // Tanlov qoidasi serverdagi bilan bir xil: dueAt bo'yicha, eng eski muddatlilardan.
    // So'ralgan va yig'ilgan son farq qilsa — «ketyapti» holatidagi kabi shu yerda ham
    // KO'RINADI (ilgari farq faqat progress paytida ko'rinib, tugagach yo'qolardi).
    const label = short > 0
      ? `${n(job.total)} ${t('ta mijoz ZIP arxivi (eng eski muddatlilardan) —')} ${n(job.asked!)} ${t('ta so‘ralgan edi,')} ${n(short)} ${t('tasi tayyor emas edi. Yuklab olish')}`
      : `${n(job.total)} ${t('ta mijoz ZIP arxivi (eng eski muddatlilardan) — yuklab olish')}`;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={`/api/export/${job.jobId}/download`}
          title={label} aria-label={label}
          className={`${ZIP_BTN} border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 focus-visible:ring-emerald-500/40 dark:text-emerald-300`}
        >
          <IcoDown />
          <span className="absolute -right-1 -top-1 rounded-full bg-emerald-600 px-1 text-[9px] font-bold leading-[14px] text-white tabular-nums" aria-hidden>
            {n(job.total)}
          </span>
        </a>
        {/* So'ralgani bilan yig'ilgani farqi TUGAGACH HAM ko'rinib tursin: «500 so'radim,
            arxivda 480 ta» savoli aynan shu yerda tug'iladi (nishonchada faqat 480 turadi). */}
        {short > 0 && (
          <span className="text-[10px] leading-tight text-amber-600 dark:text-amber-400" title={`${n(job.asked!)} ${t('ta so‘raldi,')} ${n(job.total)} ${t('tasi arxivga tushdi')}`}>
            −{n(short)}
          </span>
        )}
        {sendable > 0 && (
          <button type="button" onClick={onStart} title={`${t('Yangi ZIP —')} ${n(sendable)} ${t('ta tayyor')}`} aria-label={`${t('Yangi ZIP —')} ${n(sendable)} ${t('ta tayyor')}`}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted outline-none transition-colors hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          </button>
        )}
      </div>
    );
  }

  // KETYAPTI — halqa progressni ko'rsatadi. NAVBATDA (worker hali olmagan) va
  // TAYYORLANMOQDA farqlanadi: navbatdagi ish tabiiy ravishda 0% da turadi va ilgari u
  // «osilib qolgan»dan farq qilmasdi («0/100 aylanyabdi»).
  if (running) {
    const pending = job!.status === 'PENDING';
    const label = pending
      ? `${t('ZIP navbatda')}${job!.total ? ` — ${n(job!.total)} ${t('ta mijoz')}` : ''}`
      : `${t('ZIP tayyorlanmoqda —')} ${n(job!.progress)}/${n(job!.total)} (${pct}%)`;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <span className={`${ZIP_BTN} border-transparent text-fg`} title={label} aria-label={label} role="progressbar"
          aria-valuenow={pending ? undefined : pct} aria-valuemin={0} aria-valuemax={100} aria-live="polite">
          <ZipRing pct={pct} indeterminate={pending} />
          <span className="text-[10px] font-semibold tabular-nums">{pending ? '…' : pct}</span>
        </span>
        {/* Bekor — ilgari yo'q edi: noto'g'ri son bilan boshlangan ZIP tugashini kutishdan
            boshqa chora qolmasdi (va u soatlab ketishi mumkin). */}
        {onCancel && job!.jobId > 0 && (
          <button type="button" onClick={() => onCancel(job!.jobId)}
            title={job!.message === 'Bekor qilinmoqda…' ? t('Bekor qilinmoqda…') : t('ZIP tayyorlashni bekor qilish')}
            aria-label={t('ZIP tayyorlashni bekor qilish')}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted outline-none transition-colors hover:bg-rose-500/10 hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-rose-500/30">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
        {short > 0 && (
          <span className="text-[10px] leading-tight text-amber-600 dark:text-amber-400" title={`${n(job!.asked!)} ${t("ta so'raldi,")} ${n(job!.total)} ${t('tasi tayyor edi')}`}>
            −{n(short)}
          </span>
        )}
      </div>
    );
  }

  // XATO — qizil ikonka; sabab title'da to'liq, yonida qisqartirilgan holda ko'rinadi
  // (xato butunlay yashirilmasin, lekin qatorni ham cho'zmasin).
  const failed = job?.status === 'FAILED' || !!job?.error;
  const err = job?.message || job?.error || t('ZIP tayyorlanmadi');
  const idleLabel = sendable > 0
    ? `${t('ZIP —')} ${n(sendable)} ${t("ta tayyor mijoz hujjatlarini bitta arxivga yig'ish (sudga yuborilmaydi)")}`
    : t('ZIP — tayyor mijoz yo‘q');
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button" onClick={onStart} disabled={sendable === 0}
        title={failed ? `${err} ${t('— qayta urinish uchun bosing')}` : idleLabel}
        aria-label={failed ? `${t('ZIP xatosi:')} ${err}. ${t('Qayta urinish')}` : idleLabel}
        className={`${ZIP_BTN} disabled:cursor-not-allowed disabled:opacity-40 ${failed
          ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 focus-visible:ring-rose-500/40 dark:text-rose-300'
          : 'border-line text-muted hover:border-brand-500/40 hover:text-fg focus-visible:ring-brand-500/30'}`}
      >
        <IcoDown />
      </button>
      {failed && (
        <span className="max-w-[9rem] truncate text-[10px] font-medium text-rose-500" role="alert" title={err}>{err}</span>
      )}
    </div>
  );
}

// ── per-client drill-down (the MUST feature) ─────────────────────────────────
// Tab tartibi (foydalanuvchi tanlovi): Tayyor emas · Tayyor · Qoralama · Yuborilgan · Hammasi.
// «Tayyor» = sendable (hujjati to'liq, hali qoralama/yuborilmagan) — bevosita shu tab'dan yuboriladi.
// Har tab o'z rangi + ikoni bilan (statusChip bilan mos): rose · emerald · violet · sky · slate.
const svg = (d: React.ReactNode) => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const CLIENT_FILTERS: { key: ReadyFilter; label: string; icon: React.JSX.Element; activeCls: string; iconCls: string }[] = [
  { key: 'notready', label: 'Tayyor emas', icon: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>), activeCls: 'bg-rose-500/15 text-rose-600 dark:text-rose-300', iconCls: 'text-rose-500' },
  { key: 'sendable', label: 'Tayyor', icon: svg(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>), activeCls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', iconCls: 'text-emerald-500' },
  // «Navbatda» — partiyaga olingan, sudga hali yetib bormagan. ATAYIN «Tayyor»dan keyin:
  // operator 200 tani navbatga bergach, ular «Tayyor»dan chiqib SHU YERGA o'tadi. Ilgari
  // bunday holat umuman yo'q edi va 200 ta ish ikkala joyda ham sanalardi.
  { key: 'queued', label: 'Navbatda', icon: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>), activeCls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', iconCls: 'text-amber-500' },
  // «Qoralama tayyor» — ADOLAT'da tayyorlangan (Murojaatlarim), sudga «Sudga o'tkazish» tabidan
  // yuboriladi. ATAYIN «Tayyor»dan keyin va «Sudda»dan oldin: ish tayyor bo'ldi, ammo hali sudda emas.
  { key: 'draftReady', label: 'Qoralama tayyor', icon: svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="m9 15 2 2 4-4" /></>), activeCls: 'bg-teal-500/15 text-teal-700 dark:text-teal-300', iconCls: 'text-teal-500' },
  { key: 'submitted', label: 'Sudda', icon: svg(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></>), activeCls: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300', iconCls: 'text-indigo-500' },
  { key: 'all', label: 'Hammasi', icon: svg(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>), activeCls: 'bg-slate-500/15 text-slate-700 dark:text-slate-300', iconCls: 'text-slate-500' },
];

// Firma qatorida ko'rsatiladigan holat chiplari — «Hammasi» dan boshqa hammasi.
// ALOHIDA konstanta: qator layouti (ustunlar soni) ham shu ro'yxatdan hisoblanadi, ya'ni
// yangi holat qo'shilganda grid o'zi moslashadi va hech nima keyingi qatorga tushmaydi.
const FIRM_STAT_CHIPS = CLIENT_FILTERS.filter((f) => f.key !== 'all');

// Firma qatoridagi qisqa xulosa — tab'lar bilan bir xil ikon/rang (Tayyor emas · Tayyor · Qoralama · Yuborilgan),
// «batafsil» yopiq paytda ko'rinadi. `all` chiqmaydi (u umumiy jami).
const firmStatValue = (fr: FirmReadiness, key: ReadyFilter): number =>
  key === 'notready' ? fr.total - fr.ready : key === 'sendable' ? fr.sendable : key === 'queued' ? fr.queued : key === 'draftReady' ? fr.draftReady
    : key === 'submitted' ? fr.submitted : fr.total;
function statusChip(r: ClientRow, t: (s: string) => string) {
  // «Sudda» va «Chiqarilgan» — ATAYIN ikki xil holat.
  // 2026-09-07: BRIGHT qatorida «Yuborilgan 100» ko'rinardi, lekin ularning bittasi ham
  // sudga ketmagan edi — 100 tasida faqat ZIP paketi chiqarilgan. Operator ularni sudda
  // deb o'ylashi mumkin edi, shuning uchun endi belgi aniq: sudda bo'lgani — «Sudda».
  if ((r as { submitted?: boolean }).submitted) {
    // QO'LDA kiritilgani ALOHIDA belgilanadi: mijoz «Tayyor»dan yo'qolgan bo'lsa, operator
    // sababini shu yerda ko'radi — aks holda u sababsiz g'oyib bo'lgandek tuyulardi.
    if ((r as { submittedExternal?: boolean }).submittedExternal) {
      return <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300" title={t("ADOLAT'da bu odamga shu firma nomidan tirik da'vo bor — biz yubormaganmiz (yurist portalda qo'lda kiritgan). Shuning uchun qayta yuborilmaydi.")}>{t('Portalda bor')}</span>;
    }
    return <span className="rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300" title={t("Da'vo ADOLAT orqali sudga topshirilgan")}>{t('Sudda')}</span>;
  }
  // «Navbatda» — partiyaga olingan, sudga hali yetmagan. Busiz bunday ish «Tayyor» ko'rinardi
  // va operator uni ikkinchi marta yuborishga urinardi.
  if ((r as { queued?: boolean }).queued) {
    return <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300" title={t('Partiyaga olingan — navbati kelishini kutmoqda')}>{t('Navbatda')}</span>;
  }
  if ((r as { draftReady?: boolean }).draftReady) return <span className="rounded-md bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300" title={t("ADOLAT'da qoralama tayyor — sudga hali yuborilmagan («Sudga o‘tkazish» tabida yuboriladi)")}>{t('Qoralama tayyor')}</span>;
  if (r.sendable) return <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">{t('Tayyor')}</span>;
  return <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-300">{t('Tayyor emas')}</span>;
}

const ClientRowCard = React.memo(function ClientRowCard({ r, firmId, selectable, checked, onCheck, onChanged, onUndo, undoing }: {
  r: ClientRow; firmId: number; selectable: boolean; checked: boolean; onCheck: (id: number, v: boolean) => void; onChanged: () => void;
  onUndo?: (id: number) => void; undoing?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const active = selectable && checked;
  return (
    <div className={`rounded-xl border bg-surface transition-colors ${active ? 'border-brand-500/60 bg-brand-500/[0.04]' : 'border-line'}`}>
      <div className="flex items-center gap-3 p-2.5">
        {selectable && (
          <label className="flex shrink-0 cursor-pointer items-center" title={t('Tanlash')}>
            <input type="checkbox" checked={checked} onChange={(e) => onCheck(r.caseId, e.target.checked)} aria-label={t('Tanlash')} className="peer sr-only" />
            <span className={`grid h-5 w-5 place-items-center rounded-md border-2 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/30 ${checked ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-surface text-transparent hover:border-brand-500/60'}`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>
            </span>
          </label>
        )}
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${avatarColor(r.pinfl || '')}`} aria-hidden>{initials(r.clientName)}</span>
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setOpen((v) => !v)} title={t('Mijoz hujjatlarini ochish')}>
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{r.clientName || '—'}</span>
            {statusChip(r, t)}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span className="tabular-nums">{r.pinfl}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5">{r.stageLabel}</span>
            <DueBadge d={r.daysLeft} />
          </div>
        </div>
        {/* Sud uchun 4 ta shart (talabnoma·check·skan·oferta), so'ng ajratilgan «boji» — ma'lumot uchun. */}
        <div className="flex shrink-0 items-center gap-1.5" title={t('Sud sharti (5 tasi ham MAJBURIY): Talabnoma · Check (kvitansiya) · Skan · Oferta · Boji (invoice raqami)')}>
          <DocTile ok={r.talabnoma} label="Talabnoma" />
          {/* Check = talabnoma UZPOST kvitansiyasi biriktirilgan (MAJBURIY). Yonida hippo-delivered ko'rsatkichi. */}
          <DocTile ok={r.receipt} label="Check" />
          {!r.receipt && r.talabnomaDelivered && (
            <Tip label={t('xat.hippo yetkazilgan, lekin kvitansiya hali biriktirilmagan — «Cheklarni biriktirish»')} className="shrink-0">
              <span className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300">hippo✓</span>
            </Tip>
          )}
          <DocTile ok={r.scan} label="Skan" />
          <DocTile ok={r.oferta} label="Oferta" />
          {/* Boji = invoice RAQAMI (receiptNumber) bor — endi MAJBURIY (raqam ariza ichiga yoziladi). */}
          <DocTile ok={r.boji} label="Boji" />
        </div>
        <span className="hidden w-24 shrink-0 text-right text-sm font-semibold tabular-nums sm:block">{sum(r.totalDebt)}</span>
        {/* «Bekor» — qatorning o'zida (modalga kirmasdan): yuborilganni → «Tayyor»ga qaytaradi. */}
        {r.exported && onUndo && (
          <Tip label={t('Bekor qilib «Tayyor»ga qaytarish')} className="shrink-0">
            <button onClick={() => onUndo(r.caseId)} disabled={undoing} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] font-medium text-rose-600 outline-none transition-colors hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/30 disabled:opacity-50 dark:text-rose-300">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
              {undoing ? '…' : t('Bekor')}
            </button>
          </Tip>
        )}
        {/* Har mijozni ochib hujjatlarini koʻrish + qoʻshimcha biriktirish (tayyor boʻlsa ham). */}
        <Tip label={r.ready ? t('Mijoz hujjatlari — koʻrish va qoʻshimcha biriktirish') : t('Yetishmagan hujjatlarni toʻldirish')} className="shrink-0">
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${r.ready ? 'border-line text-muted hover:border-brand-500/40 hover:text-fg' : 'border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'}`}>
            {r.ready ? t('Hujjatlar') : t('Toʻldirish')} {open ? '▲' : '▼'}
          </button>
        </Tip>
      </div>
      {/* Hujjatlar boshqa qadamlardagidek MODALda ochiladi (inline emas — ro'yxat joyida turadi). */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={r.clientName || t('Mijoz hujjatlari')}
        description={`${r.pinfl ?? ''} · ${r.stageLabel}`}
        size="xl"
        footer={
          <>
            {r.exported && onUndo && (
              <button
                onClick={() => onUndo(r.caseId)}
                disabled={undoing}
                className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-600 outline-none transition-colors hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/30 disabled:opacity-50 dark:text-rose-300"
                title={t('Yuborilganni bekor qilib «Tayyor»ga qaytaradi')}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
                {undoing ? t('Bekor qilinmoqda…') : t('Bekor qilish')}
              </button>
            )}
            <button onClick={onChanged} className="btn-ghost text-xs">{t('Yangilash')}</button>
            <button onClick={() => setOpen(false)} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600">{t('Yopish')}</button>
          </>
        }
      >
        <CaseDocs caseId={r.caseId} firmId={firmId} stage={r.stage} receiptNumber={r.receiptNumber} talabnomaSent={r.talabnoma} onChange={onChanged} courtFlags={{ talabnoma: r.talabnoma, scan: r.scan, oferta: r.oferta, receipt: r.receipt, boji: r.boji }} />
      </Modal>
    </div>
  );
});

function ClientDrilldown({ firmId, snapshotId, job, startExport, onChanged, batchActive }: {
  firmId: number; snapshotId?: number; job?: JobState;
  startExport: (caseIds: number[]) => void; onChanged: () => void;
  // Serverda ketayotgan partiya — tanlab yuborish tugmasi ham u tugaguncha bloklanadi
  // (prepare-ready baribir 409 qaytaradi; tugmani yoqilgan qoldirish faqat chalg'itadi).
  batchActive?: { jobId: number; status: string; queuePos: number } | null;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<ReadyFilter>('sendable');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ClientPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const reqRef = useRef(0);
  const loadedOnce = useRef(false);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [filter, debouncedQ]);

  // Fetch the WHOLE firm's rows ONCE (per firm/snapshot). Filter/search/paginate happen client-side
  // (below), so switching a tab or page never re-hits the server — that per-interaction refetch (each
  // loading the firm's cases + meta) was the «juda sekin».
  const load = useCallback(async () => {
    const my = ++reqRef.current;
    if (!loadedOnce.current) setLoading(true); else setRefreshing(true);
    setError(null);
    const qs = new URLSearchParams({ firmId: String(firmId) });
    if (snapshotId) qs.set('s', String(snapshotId));
    try {
      const d = await getJson(`/konveyer/court-ready/clients?${qs.toString()}`, { cache: 'no-store' }, t);
      if (my !== reqRef.current) return;
      setData(d); loadedOnce.current = true;
    } catch (e) {
      if (my !== reqRef.current) return;
      setError(e instanceof Error ? e.message : t('Yuklab boʻlmadi')); // keep the previous rows visible
    } finally { if (my === reqRef.current) { setLoading(false); setRefreshing(false); } }
  }, [firmId, snapshotId]);
  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => { load(); onChanged(); }, [load, onChanged]);
  // Tab sonlari — mahalliy `data.rows`dan hisoblanadi (server `counts` emas). Shunda bitta qatorni
  // OPTIMISTIK o'zgartirsak (undo), sonlar DARROV to'g'rilanadi — butun ro'yxatni qayta yuklash shart emas.
  const counts = React.useMemo<ClientCounts | undefined>(
    () => (data ? tallyClientCounts(data.rows) : undefined),
    [data],
  );
  // Bitta qatorni joyida yangilash (optimistik) — to'liq refetch/flash yo'q.
  const patchRow = useCallback((caseId: number, patch: Partial<ClientRow>) => {
    setData((prev) => (prev ? { ...prev, rows: prev.rows.map((row) => (row.caseId === caseId ? { ...row, ...patch } : row)) } : prev));
  }, []);
  const running = !!job && (job.status === 'PENDING' || job.status === 'RUNNING');

  // «Bekor qilish» — kalit SHART EMAS: oddiy tasdiq modali («rostdan bekor qilaymi?») → so'ng «Tayyor»ga
  // qaytaradi. Backend: POST /konveyer/court-undo (meta.exportedAt/draftAt olib tashlanadi).
  const undo = useCallback(async (caseId: number) => {
    const ok = await confirm({
      title: t('Yuborishni bekor qilish'),
      description: t('Rozimisiz? Mijoz sud paketidan chiqarilib, «Tayyor»ga qaytadi.'),
      confirmLabel: t('Ha, bekor qilish'), danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch('/konveyer/court-undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseIds: [caseId] }) });
      if (!res.ok) return;
      // OPTIMISTIK: faqat o'sha qator «Tayyor»ga qaytadi — butun ro'yxat qayta yuklanmaydi (flash yo'q).
      const row = data?.rows.find((r) => r.caseId === caseId);
      const backToReady = !!row && row.ready && !['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED'].includes(row.stage);
      patchRow(caseId, { exported: false, sendable: backToReady });
      setSelected((s) => { if (!s.has(caseId)) return s; const n = new Set(s); n.delete(caseId); return n; });
      onChanged(); // faqat firma-summa (parent) yangilanadi — drill-down mahalliy qoladi
    } catch { /* tarmoq xatosi — jim */ }
  }, [confirm, data, patchRow, onChanged]);

  // Yuborish tugagach (job DONE'ga o'tganda) — drill-down ro'yxatini QAYTA yuklaymiz: yuborilgan
  // mijozlar «Yuborilgan»ga o'tadi, tab sonlari (Tayyor/Yuborilgan) firma-summa bilan mos bo'ladi.
  // Aks holda ro'yxat eskirib qoladi (tab 53, firma 52 — nomuvofiqlik).
  const lastJobStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const st = job?.status;
    if (st === 'DONE' && lastJobStatus.current && lastJobStatus.current !== 'DONE') {
      setSelected(new Set()); // yuborilganlar endi «Tayyor»da yo'q — tanlovni tozalaymiz
      load();
    }
    lastJobStatus.current = st;
  }, [job?.status, load]);

  // Client-side filter + search + pagination over the full row set — instant, no refetch.
  const DRILL_PAGE = 12;

  // Firmaning ishlari bir necha sudga bo'lingan bo'lishi mumkin va ulardan biri ADOLAT'da
  // yopiq bo'lishi mumkin (BRIGHT: Yuqorichirchiq yopiq, Uchtepa ochiq). Sud bo'yicha filtr
  // operatorga ochiq sudnikini ajratib yuborish imkonini beradi — aks holda firma butunlay
  // to'xtab qolardi.
  // Chip raqamlari FAOL TAB bo'yicha sanaladi (sud filtri hisobga olinmaydi — aks holda
  // tanlangan chip o'zini o'zi sanardi). Avval umumiy son ko'rsatilardi va «Uchtepa 21»
  // deb turib ro'yxat bo'sh chiqardi — chunki o'sha 21 tasining hech biri «Tayyor» emas edi.
  const courtOptions = React.useMemo(() => {
    const m = new Map<string, { id: number | null; name: string; enabled: boolean; count: number }>();
    for (const r of data?.rows ?? []) {
      const okFilter = filter === 'sendable' ? r.sendable : filter === 'queued' ? !!r.queued : filter === 'draftReady' ? !!r.draftReady : filter === 'ready' ? r.ready : filter === 'submitted' ? !!r.submitted : filter === 'notready' ? !r.ready : true;
      if (!okFilter) continue;
      const k = String(r.courtId ?? 'none');
      const it = m.get(k) ?? { id: r.courtId ?? null, name: r.courtName ?? t('Sud tayinlanmagan'), enabled: r.courtEnabled !== false, count: 0 };
      it.count++;
      m.set(k, it);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [data, filter]);

  const [courtFilter, setCourtFilter] = useState<number | null | 'all'>('all');

  // Tab almashganda tanlangan sud o'sha tabda bo'lmasligi mumkin — «Hammasi»ga qaytamiz,
  // aks holda ro'yxat sababsiz bo'sh ko'rinadi.
  useEffect(() => {
    if (courtFilter !== 'all' && !courtOptions.some((c) => c.id === courtFilter)) setCourtFilter('all');
  }, [courtOptions, courtFilter]);

  // Ochiq turgan «Navbatda» tab'i bo'shab qolsa — tab yo'qoladi, shuning uchun tanlovni
  // «Tayyor»ga qaytaramiz (aks holda hech qanday tab faol bo'lmagan bo'sh ekran qoladi).
  useEffect(() => {
    if (filter === 'queued' && counts && counts.queued === 0) setFilter('sendable');
  }, [filter, counts]);

  const filtered = React.useMemo(() => {
    const src = data?.rows ?? [];
    const needle = debouncedQ.trim().toLowerCase();
    return src.filter((r) => {
      const okFilter = filter === 'sendable' ? r.sendable : filter === 'queued' ? !!r.queued : filter === 'draftReady' ? !!r.draftReady : filter === 'ready' ? r.ready : filter === 'submitted' ? !!r.submitted : filter === 'notready' ? !r.ready : true;
      if (!okFilter) return false;
      if (courtFilter !== 'all' && (r.courtId ?? null) !== courtFilter) return false;
      if (needle && !`${r.clientName ?? ''} ${r.pinfl ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, filter, debouncedQ, courtFilter]);
  const pages = Math.max(1, Math.ceil(filtered.length / DRILL_PAGE));
  const rows = filtered.slice((page - 1) * DRILL_PAGE, (page - 1) * DRILL_PAGE + DRILL_PAGE);

  const toggle = useCallback((id: number, v: boolean) => setSelected((s) => { const next = new Set(s); if (v) next.add(id); else next.delete(id); return next; }), []);
  // «Hammasini belgilash» — barcha filtrlangan navbatdagilar, backend MAX_COURT_BATCH cheklovi bilan.
  const selectableIds = filter === 'sendable' ? filtered.map((r) => r.caseId).slice(0, MAX_COURT_BATCH) : [];
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (selectableIds.every((id) => next.has(id))) selectableIds.forEach((id) => next.delete(id));
    else selectableIds.forEach((id) => next.add(id));
    return next;
  });
  // Only OPEN the E-IMZO gate here — do NOT clear the selection yet. startExport merely opens the
  // sign modal; if the operator cancels the sign, the batch is never sent, so the checked cases must
  // survive (clearing eagerly here lost them on cancel). The rows refresh out of «Navbatda» after a
  // successful send anyway, and the server re-validates the ids.
  const doExport = () => { if (selected.size === 0) return; startExport([...selected]); };

  return (
    <div className="border-t border-line bg-surface-2/30 p-3">
      {/* filter chips with live counts */}
      <div className="mb-2 flex flex-wrap gap-1">
        {/* «Navbatda» tab'i faqat navbatda ish bo'lsa — bo'sh tab bosilsa quruq ro'yxat chiqadi. */}
        {CLIENT_FILTERS.filter((f) => f.key !== 'queued' || (counts?.queued ?? 0) > 0).map((f) => {
          const active = filter === f.key;
          const cnt = counts ? counts[f.key] : undefined;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active ? f.activeCls : 'bg-surface-2 text-muted hover:text-fg'}`}
            >
              <span className={active ? '' : f.iconCls}>{f.icon}</span>
              {t(f.label)}
              {cnt != null && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${active ? 'bg-black/[0.06] dark:bg-white/10' : 'bg-surface text-muted'}`}>{n(cnt)}</span>}
            </button>
          );
        })}
      </div>

      {/* search */}
      <div className="relative mb-2">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Mijoz qidirish')} placeholder={t('F.I.O yoki PINFL…')} className="w-full rounded-xl border border-line bg-surface py-2 pl-10 pr-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" />
      </div>

      {/* SUD bo'yicha filtr — firma ishlari bir necha sudga bo'lingan bo'lsa ko'rinadi.
          Yopiq sud (ADOLAT qabul qilmaydi) alohida belgilanadi, chunki undagi ishlarni
          tanlash mumkin bo'lsa-da, yuborish baribir xato beradi. */}
      {courtOptions.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted">{t('Sud:')}</span>
          <button
            onClick={() => { setCourtFilter('all'); setPage(1); }}
            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${courtFilter === 'all' ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2'}`}
          >
            {t('Hammasi')}
          </button>
          {courtOptions.map((c) => {
            const on = courtFilter === c.id;
            return (
              <button
                key={String(c.id ?? 'none')}
                onClick={() => { setCourtFilter(c.id); setPage(1); }}
                title={c.enabled ? undefined : t('ADOLAT’da bu sud elektron ariza qabul qilmaydi')}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                  on ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2'
                }`}
              >
                {!c.enabled && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />}
                <span className={c.enabled ? '' : 'opacity-70'}>{c.name}</span>
                <span className="tabular-nums opacity-70">{n(c.count)}</span>
              </button>
            );
          })}
          {/* Yopiq sud tanlangan bo'lsa — oldindan ogohlantiramiz. Yuborish baribir xato
              beradi, lekin buni bosishdan OLDIN bilgan ma'qul. */}
          {courtFilter !== 'all' && courtOptions.find((c) => c.id === courtFilter && !c.enabled) && (
            <span className="w-full text-[10px] leading-snug text-amber-600 dark:text-amber-400">
              {t('Bu sud ADOLAT’da elektron ariza qabul qilmaydi — yuborish xato beradi. Sud administratori yoqishi kerak.')}
            </span>
          )}
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : error && !data ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-[12px] font-medium text-rose-500" role="alert">
          <span>{error}</span>
          <button onClick={() => load()} className="rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">{t('Qayta urinish')}</button>
        </div>
      ) : (
        <div className={refreshing ? 'opacity-60 transition-opacity duration-200' : 'transition-opacity duration-200'}>
          {error && <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" role="alert">{t('Yangilanmadi — eski roʻyxat koʻrsatilyapti.')}</div>}
          {rows.length === 0 ? (
            // A filter/search switch refetches; the OLD filter's rows may be empty, so show a skeleton
            // while the new list loads instead of a false «Bu filtrda mijoz yoʻq».
            refreshing
              ? <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />)}</div>
              : <div className="rounded-lg border border-line bg-surface px-3 py-6 text-center text-sm text-muted">{debouncedQ ? `«${debouncedQ}» ${t('topilmadi')}` : t('Bu filtrda mijoz yoʻq.')}</div>
          ) : (
            <>
              {/* Yopishib turadigan YUQORI panel — belgilash + «Qoralama tayyorlash» doim ko'rinadi (pastda qolmaydi).
                  2026-09-19: tugma «Sudga yuborish» deb yozilgan bo'lsa ham doim QORALAMA qilardi —
                  endi nomi ham, rejimi ham bir xil (suitMode: «Murojaatlarim»da qoralama). */}
              {filter === 'sendable' && selectableIds.length > 0 && (
                <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium" title={t('Barcha tayyorlarni belgilash')}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t('Hammasini belgilash')} className="peer sr-only" />
                    <span className={`grid h-5 w-5 place-items-center rounded-md border-2 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/30 ${allSelected ? 'border-brand-500 bg-brand-500 text-white' : someSelected ? 'border-brand-500 bg-brand-500/15 text-brand-600 dark:text-brand-400' : 'border-line bg-surface text-transparent hover:border-brand-500/60'}`}>
                      {allSelected
                        ? <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>
                        : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round"><path d="M6 12h12" /></svg>}
                    </span>
                    {t('Hammasini belgilash')}{filtered.length > MAX_COURT_BATCH ? ` (${t('birinchi')} ${MAX_COURT_BATCH})` : ''}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted">{n(selected.size)} / {n(filtered.length)}</span>
                    {selected.size > 0 && (
                      <>
                        <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs">{t('Bekor')}</button>
                        <button
                          onClick={doExport}
                          disabled={running}
                          title={batchActive
                            ? `${t('Bu firmaning partiyasi hozir')} ${batchActive.status === 'RUNNING' ? t('ketmoqda') : t('navbatda')} (#${batchActive.jobId}). ${t('Tugashini kuting — keyin belgilanganlar uchun qoralama tayyorlanadi.')}`
                            : `${n(selected.size)} ${t("ta belgilangan ish uchun ADOLAT'da qoralama tayyorlash (sudga yuborilmaydi)")}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40">
                          {batchActive ? <><IcoPlus /> {t('Navbatga qo‘shish')} ({n(selected.size)})</> : <><IcoBolt /> {t('Qoralama tayyorlash')} ({n(selected.size)})</>}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                {rows.map((r) => (
                  <ClientRowCard key={r.caseId} r={r} firmId={firmId} selectable={filter === 'sendable'} checked={selected.has(r.caseId)} onCheck={toggle} onChanged={refresh} onUndo={undo} />
                ))}
              </div>
              {pages > 1 && (
                <div className="mt-2 flex items-center justify-between">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">{t('Oldingi')}</button>
                  <span className="text-xs tabular-nums text-muted">{t('Sahifa')} {page} / {pages} · {n(filtered.length)} {t('ta')}</span>
                  <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">{t('Keyingi')}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── one firm row ─────────────────────────────────────────────────────────────
// ── Umumiy «sudga real yuborish» pauzasi — bu tab'dan OLIB TASHLANDI (2026-09-20).
// U faqat REAL yuborishga (send-to-court) ta'sir qiladi, qoralamaga emas — shuning uchun
// boshqaruvi «Sudga o'tkazish» (3-tab) gate panelida turadi. Bu yerda turgani operatorni
// chalg'itardi: «pauza bosdim, Go nega ishlayapti?».

// ── Sudga yuborish navbati: HAR BIR ISH bo'yicha holat ────────────────────────────────────
// Job progress'i «3/100» deydi, lekin qaysi ish yiqilgani va NEGA — ko'rinmaydi. Operator
// aynan shuni bilishi kerak: xato bergan ishni topib, sababini o'qib, tuzatib qayta yuborish.
type QueueRow = {
  caseId: number; clientName: string | null; pinfl: string | null; state: string;
  error: string | null; draftId: string | null; caseNumber: string | null; attempts: number; step?: string | null;
  /** Rejim — route qaytarsa (ixtiyoriy). */ draftMode?: boolean; suitMode?: boolean;
};
const Q_STATE: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Navbatda', tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
  RUNNING: { label: 'Ketyapti…', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  DONE: { label: 'Bajarildi', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  FAILED: { label: 'Xato', tone: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  SKIPPED: { label: 'Oʻtkazildi', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
};
// SKIPPED — faqat «boji to'lanmagan» EMAS (2026-09-19): tashqi da'vo (portalda allaqachon bor),
// ushlab turilgan qaytgan ish, talabnoma yetkazilmagan yoki invoice raqami yo'q. Aniq sabab —
// har qatorning lastError'ida (QueuePanel ro'yxati), yig'ma chiplarda umumiy izoh.
const SKIP_HINT = 'Portalga chiqarilmadi: invoice raqami yo‘q, talabnoma yetkazilmagan, portalda allaqachon da’vo bor yoki qaytgan ish ushlab turilgan. Aniq sababi — navbat ro‘yxatida.';
// DONE yorlig'i REJIMGA qarab: qoralama (draft/suit) — «Qoralama tayyor», real — «Yuborildi».
// court-queue GET hozircha rejim maydonlarini qaytarmaydi (select'da yo'q) — bo'lmasa, sud ish
// raqami bor qator real deb, qolgani neytral «Bajarildi» deb ko'rsatiladi (yolg'on «Yuborildi» emas).
function qStateLabel(row: QueueRow): string {
  if (row.state !== 'DONE') return (Q_STATE[row.state] ?? Q_STATE.PENDING).label;
  if (row.suitMode || row.draftMode) return 'Qoralama tayyor';
  if (row.suitMode === false && row.draftMode === false) return 'Yuborildi';
  return row.caseNumber ? 'Yuborildi' : 'Bajarildi';
}

// `onChanged` — navbatga TEGILGANDA (bekor qilish) yuqoridagi raqamlarni ham qayta
// o'qitadi: bekor qilish kunlik limitni bo'shatadi va ishlarni «Tayyor»ga qaytaradi,
// ya'ni firma qatoridagi sonlar ham o'zgaradi. Busiz panel yangilanar, tepasi esa
// eski raqamlarni ko'rsatib turardi.
function QueuePanel({ firmId, live, onChanged }: { firmId: number; live: boolean; onChanged?: () => void }) {
  const t = useT();
  const [data, setData] = useState<{ counts: Record<string, number>; rows: QueueRow[]; truncated?: boolean; totalAll?: number } | null>(null);
  const [open, setOpen] = useState(false);

  const [err, setErr] = useState<string | null>(null);

  // FIRMA darajasidagi pauza — umumiy pauzadan mustaqil. Bitta firmani to'xtatib
  // qo'yib, boshqasining partiyasini o'tkazib yuborish uchun (2026-09-07: BRIGHT'ning
  // 200 taligi ketayotganda URBAN'ning 3 tasi ~3 soat kutib qolgan edi).
  const [firmPaused, setFirmPaused] = useState<boolean | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);

  const loadPause = useCallback(async () => {
    try {
      const d = await getJson<{ pausedFirms?: number[] }>('/konveyer/court-queue/pause', undefined, t);
      setFirmPaused((d?.pausedFirms ?? []).includes(firmId));
    } catch { /* holat belgisi — o'qilmasa tugma ko'rsatilmaydi */ }
  }, [firmId]);

  // NAVBATNI BUTUNLAY BEKOR QILISH (pauzadan farqli — qolgan ishlar ro'yxatdan chiqadi).
  const confirmQ = useConfirm();
  const [cancelBusy, setCancelBusy] = useState(false);

  const cancelQueue = async (waitingNow: number, doneNow: number) => {
    if (cancelBusy) return;
    const ok = await confirmQ({
      title: t('Navbat bekor qilinsinmi?'),
      description:
        `${t('Navbatda turgan')} ${n(waitingNow)} ${t("ta ish ro'yxatdan chiqariladi — ular uchun qoralama tayyorlanmaydi.")} ` +
        `${t('Allaqachon bajarilgan')} ${n(doneNow)} ${t('ta ishga TEGILMAYDI.')} ` +
        `${t("Ayni damda portalga ketayotgan bitta ish oxirigacha boradi (yarim yo'lda uzilsa ADOLAT'da yetim qoralama qoladi).")} ` +
        `${t("Firma to'xtatilgan holatga o'tadi (Go ham shu firmani chetlab o'tadi) — keyin «Davom ettirish» yoki «Qoralama tayyorlash» bilan qaytasiz.")}`,
      confirmLabel: t('Ha, bekor qilinsin'),
      danger: true,
    });
    if (!ok) return;
    setCancelBusy(true);
    setErr(null);
    try {
      const r = await fetch('/konveyer/court-queue/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.error || t('Bekor qilinmadi')); return; }
      setFirmPaused(true);
      await load();
      onChanged?.();   // firma qatoridagi «Tayyor / Sudda» sonlari ham darhol yangilansin
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('Bekor qilinmadi'));
    } finally { setCancelBusy(false); }
  };

  // XATO BERGAN ISHLARNI QAYTA URINISH (o'z rejimida — 2026-09-19 dan qoralama; real yuborish
  // bu yerda yo'q, u faqat «Sudga o'tkazish» tabida).
  //
  // Avtomatika bunday ishni 3 urinishdan keyin tinch qo'yadi (sabab odatda doimiy).
  // Kamchilik tuzatilgach ularni qaytadan yo'lga solishning UI'da yo'li yo'q edi:
  // 2026-09-08 da Yuqorichirchiq 308 ta ishni hujjat tartibi uchun rad etdi, tartib
  // kodda tuzatildi va operator qo'lida hech narsa qolmadi.
  const [retryBusy, setRetryBusy] = useState(false);

  const retryFailed = async (failedNow: number) => {
    if (retryBusy) return;
    const ok = await confirmQ({
      title: t('Xato berganlar qayta urinilsinmi?'),
      description:
        `${n(failedNow)} ${t("ta ish qaytadan navbatga qo'yiladi va ADOLAT'da qoralama qayta tayyorlanadi (sudga yuborilmaydi).")} ` +
        `${t("ADOLAT'da ishi bor (ya'ni da'vosi allaqachon qabul qilingan) ishlar bunga KIRMAYDI —")} ` +
        `${t("bir odamga ikkinchi da'vo ochilmaydi.")} ` +
        `${t("Sabab tuzatilmagan bo'lsa, yana xato berishi mumkin.")}`,
      confirmLabel: t('Ha, qayta urinilsin'),
    });
    if (!ok) return;
    setRetryBusy(true);
    setErr(null);
    try {
      const r = await fetch('/konveyer/court-queue/resume', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, retryFailed: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.error || t('Qayta urinib bo‘lmadi')); return; }
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('Qayta urinib bo‘lmadi'));
    } finally { setRetryBusy(false); }
  };

  const toggleFirmPause = async () => {
    if (firmPaused === null || pauseBusy) return;
    setPauseBusy(true);
    try {
      const r = await fetch('/konveyer/court-queue/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !firmPaused, firmId }),
      });
      if (r.ok) setFirmPaused(!firmPaused);
    } catch { /* tarmoq xatosi — holat o'zgarmaydi */ } finally { setPauseBusy(false); }
  };

  const load = useCallback(async () => {
    try {
      setData(await getJson(`/konveyer/court-queue?firmId=${firmId}`, undefined, t));
      setErr(null);
    } catch (e) {
      // Avval bu jimgina yutilardi — sessiya tugaganda panel eski raqamlarni ko'rsatib
      // turaverardi va operator ular hozirgi holat deb o'ylardi.
      setErr(e instanceof Error ? e.message : t('Navbat holatini o‘qib bo‘lmadi'));
    }
  }, [firmId]);

  // Ish ketayotganda avtomatik yangilanadi.
  //
  // `live` — SHU brauzerda boshlangan job bor-yo'qligi. Lekin partiya terminaldan ham
  // boshlanishi mumkin (scripts/court-resume.ts) — u holda brauzer bilmaydi va panel qotib
  // qolardi: bosqichlar («Hujjatlar (15 ta)») umuman ko'rinmasdi. Shuning uchun navbatda
  // ishlanayotgan yozuv bo'lsa ham yangilab turamiz.
  const activeNow = (data?.counts?.RUNNING ?? 0) + (data?.counts?.PENDING ?? 0) > 0;
  useEffect(() => {
    void load();
    void loadPause();
    if (!live && !activeNow) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load, loadPause, live, activeNow]);

  const counts = data?.counts;
  const failed = counts?.FAILED ?? 0;
  const done = counts?.DONE ?? 0;
  // O'tkazilgan — portalga umuman chiqarilmagan (invoice raqami / yetkazilganlik / tashqi da'vo /
  // ushlab turilgan). XATO EMAS: kod tuzatilmaydi. Shuning uchun alohida rang va alohida sanoq.
  const skipped = counts?.SKIPPED ?? 0;
  const waiting = (counts?.PENDING ?? 0) + (counts?.RUNNING ?? 0);
  if (err) {
    return (
      <div className="border-t border-line px-3 py-2 text-[11px] text-rose-500" role="alert">
        {err}
      </div>
    );
  }
  if (!counts || (failed + done + waiting + skipped) === 0) return null;

  const total = done + waiting + failed + skipped;
  const donePct = total ? Math.round((done / total) * 100) : 0;
  const failPct = total ? Math.round((failed / total) * 100) : 0;
  const skipPct = total ? Math.round((skipped / total) * 100) : 0;

  return (
    <div className={`border-t border-line px-3 py-2 ${firmPaused ? 'bg-amber-500/[0.05]' : ''}`}>
      {/* NAVBAT CHIZIG'I — kartaning ichki tekislanishiga BO'YSUNADI.
          Ilgari bu to'liq kenglikdagi alohida polosa edi: navbat tugagan firmada (URBAN)
          undan faqat yolg'iz «99 ketdi ⌄» qolib, kartaning chap chekkasida osilib turardi,
          o'ng tomonda esa qip-qizil bo'sh joy. Endi ikki xil ko'rinish bor:
            • ish qolgan bo'lsa — chiziq + sonlar + «To'xtatish» (amallar ustuni bilan bir chiziqda);
            • navbat tugagan bo'lsa — o'ngda ixcham yakun (chiziqsiz, bo'sh polosasiz). */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className={`group flex min-w-0 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 ${waiting > 0 ? 'flex-1' : 'ml-auto'}`}
          aria-expanded={open}
          aria-label={`${t('Navbat tafsiloti')}: ${n(done)} ${t('bajarildi')}, ${n(waiting)} ${t('navbatda')}, ${n(skipped)} ${t('o‘tkazildi')}, ${n(failed)} ${t('xato')}`}
        >
          {waiting > 0 && (
            <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${donePct}%` }} />
              <span className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${skipPct}%` }} />
              <span className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${failPct}%` }} />
            </span>
          )}
          <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
            {done > 0 && (
              <span
                className="font-semibold text-emerald-600 dark:text-emerald-400"
                title={t("Shu NAVBAT orqali muvaffaqiyatli o'tganlar (qoralama tayyorlangan yoki yuborilgan). Yuqoridagi «Qoralama tayyor» / «Sudda» — firmaning BARCHA ishlari, shuning uchun farq qilishi mumkin.")}
              >{n(done)} {t('bajarildi')}</span>
            )}
            {waiting > 0 && <span className="text-muted">{n(waiting)} {t('navbatda')}</span>}
            {/* Taxminiy vaqt — har ish ~60s. Busiz ro'yxat «qotib qolgan»dek ko'rinadi. */}
            {live && waiting > 0 && (
              <span className="text-muted" title={t('Taxminiy: har ishga ~1 daqiqa')}>
                ≈{waiting >= 60 ? `${Math.round(waiting / 60)} ${t('soat')}` : `${waiting} ${t('daq')}`}
              </span>
            )}
            {skipped > 0 && (
              <span className="font-semibold text-amber-600 dark:text-amber-400" title={t(SKIP_HINT)}>
                {n(skipped)} {t('o‘tkazildi')}
              </span>
            )}
            {failed > 0 && <span className="font-semibold text-rose-600 dark:text-rose-400">{n(failed)} {t('xato')}</span>}
            <svg
              className={`h-3.5 w-3.5 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
            ><path d="m6 9 6 6 6-6" /></svg>
          </span>
        </button>

        {/* «Qayta urinish» — navbatda ish QOLMAGANDA ham kerak: xato bergan ishlar
            aynan shunday holatda qoladi (hammasi FAILED, navbat bo'sh). Shuning uchun u
            pauza tugmasidan MUSTAQIL ko'rsatiladi. */}
        {failed > 0 && (
          <button
            onClick={() => { void retryFailed(failed); }}
            disabled={retryBusy}
            title={t('Xato bergan ishlarni qaytadan navbatga qo‘yish (qoralama — sudga yuborilmaydi)')}
            className="h-7 shrink-0 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 text-[11px] font-semibold text-brand-700 outline-none transition-colors hover:bg-brand-500/[0.18] focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50 dark:text-brand-300"
          >
            {retryBusy ? '…' : `${t('Qayta urinish')} (${n(failed)})`}
          </button>
        )}

        {/* Faqat SHU firmani to'xtatish — navbatda ish bo'lgandagina ma'noli. */}
        {firmPaused !== null && waiting > 0 && (
          <>
            {firmPaused && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                {t('To‘xtatilgan')}
              </span>
            )}
            <button
              onClick={toggleFirmPause}
              disabled={pauseBusy}
              title={firmPaused
                ? t('Shu firmani davom ettirish')
                : t('Faqat SHU firmani to‘xtatish — boshqa firmalar ishlayveradi')}
              className={`h-7 shrink-0 rounded-lg border px-2.5 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 disabled:opacity-50 ${
                firmPaused
                  ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/[0.18] focus-visible:ring-emerald-500/30 dark:text-emerald-300'
                  : 'border-line text-muted hover:border-amber-500/45 hover:bg-amber-500/10 hover:text-amber-700 focus-visible:ring-amber-500/30 dark:hover:text-amber-300'
              }`}
            >
              {pauseBusy ? '…' : firmPaused ? t('Firmani davom ettirish') : t('Firmani to‘xtatish')}
            </button>
            {/* BEKOR — «To'xtatish»dan boshqa amal, shuning uchun alohida tugma.
                To'xtatish = vaqtincha (ishlar navbatda qoladi); Bekor = navbat chopiladi.
                Operator ilgari ikkinchisini UI'dan umuman qila olmasdi. */}
            <button
              onClick={() => { void cancelQueue(waiting, done); }}
              disabled={cancelBusy}
              title={t('Navbatdagi qolgan ishlarni butunlay bekor qilish (bajarilganlarga tegmaydi)')}
              className="h-7 shrink-0 rounded-lg border border-line px-2.5 text-[11px] font-semibold text-muted outline-none transition-colors hover:border-rose-500/45 hover:bg-rose-500/10 hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-rose-500/30 disabled:opacity-50 dark:hover:text-rose-300"
            >
              {cancelBusy ? '…' : t('Bekor')}
            </button>
          </>
        )}
      </div>

      {open && data && (
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-0.5">
          {data.rows.map((row, i) => {
            const st = Q_STATE[row.state] ?? Q_STATE.PENDING;
            const stLabel = qStateLabel(row);
            const failedRow = row.state === 'FAILED';
            // O'tkazib yuborilgan ish ham SABABINI ko'rsatishi kerak (chip title'ida ham, pastda ham) —
            // busiz operator «Oʻtkazildi» degan so'zdan nima qilishni bilmaydi.
            const skipRow = row.state === 'SKIPPED';
            return (
              <li
                key={row.caseId}
                className={`rounded-lg border px-2 py-1.5 text-[11px] ${
                  failedRow ? 'border-rose-500/30 bg-rose-500/[0.05]'
                    : skipRow ? 'border-amber-500/30 bg-amber-500/[0.05]'
                      : 'border-transparent bg-surface-2'
                }`}
              >
                <div className="flex items-center gap-2">
                  {/* Tartib raqami — 99 ta ish orasida qaysi biri qayerdaligini ko'rish uchun. */}
                  <span className="w-6 shrink-0 text-right tabular-nums text-muted">{i + 1}.</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${st.tone}`} title={skipRow || failedRow ? (row.error ?? undefined) : undefined}>{t(stLabel)}</span>
                  <span className="min-w-0 truncate font-medium">{row.clientName || `#${row.caseId}`}</span>
                  {/* Ayni paytdagi bosqich — faqat ketayotgan ish uchun. Busiz «Ketyapti»
                      60 soniya qimirlamay turadi va qotib qolgandek ko'rinadi. */}
                  {row.state === 'RUNNING' && row.step && (
                    <span className="shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">{row.step}</span>
                  )}
                  {/* Urinishlar soni FAQAT muammoli qatorlarda ko'rsatiladi. Muvaffaqiyatli
                      ishda «necha urinishda ketdi» ahamiyatsiz, lekin «Yuborildi» yonida
                      turgan «2×» operatorni chalkashtiradi (nima 2 marta bo'ldi — yuborildimi?). */}
                  {row.attempts > 1 && row.state !== 'DONE' && (
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted" title={t('Shuncha marta urinilgan')}>
                      {row.attempts}-{t('urinish')}
                    </span>
                  )}
                  {row.caseNumber && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-emerald-600 dark:text-emerald-400" title={t('Sud ish raqami')}>
                      {row.caseNumber}
                    </span>
                  )}
                </div>
                {/* Xato sababi to'liq — operator shu matndan nima qilishni tushunadi. */}
                {failedRow && row.error && (
                  <p className="mt-1 break-words leading-snug text-rose-600 dark:text-rose-300" role="alert">{row.error}</p>
                )}
                {skipRow && row.error && (
                  <p className="mt-1 break-words leading-snug text-amber-700 dark:text-amber-300">{row.error}</p>
                )}
                {/* Xato bo'lsa ham qoralama yaratilgan bo'lishi mumkin — ADOLAT'da yetim qolmasin. */}
                {failedRow && row.draftId && (
                  <p className="mt-0.5 font-mono text-[10px] text-muted">{t('ADOLAT qoralama:')} {row.draftId}</p>
                )}
              </li>
            );
          })}
          {/* Ro'yxat kesilgan bo'lsa — buni AYTAMIZ. Jim kesish operatorga «hammasi shu»
              deb ko'rinadi: 195 ta ishdan 300 tasi emas, 300 tasi ko'rsatiladi va qolgani
              yo'qday tuyuladi. Sanoqlar esa yuqorida to'liq turadi. */}
          {data.truncated && (
            <li className="px-2 py-1.5 text-center text-[11px] text-muted">
              {t('Ro‘yxatda')} {data.rows.length} {t('ta ko‘rsatildi (jami')} {data.totalAll}). {t('Qolganini yuqoridagi sanoqlardan ko‘ring.')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function FirmSendRow({ fr, snapshotId, job, zipJob, startExport, onZip, onZipCancel, onChanged, drillOpen, onToggleDrill, idx, batchActive, showQueued }: {
  fr: FirmReadiness; snapshotId?: number; job?: JobState; zipJob?: JobState;
  batchActive?: { jobId: number; status: string; queuePos: number } | null;
  startExport: (firmId: number, extra: Record<string, unknown>) => void;
  onZip?: () => void;
  onZipCancel?: (jobId: number) => void;
  onChanged: () => void; drillOpen: boolean; onToggleDrill: () => void; idx: number;
  /** Butun ro'yxatda navbatda ish bormi — «Navbatda» ustunini ko'rsatish/yashirish uchun. */
  showQueued?: boolean;
}) {
  const t = useT();
  const pct = fr.total ? (fr.ready / fr.total) * 100 : 0;
  const docsOk = fr.docs?.complete !== false; // firma hujjatlari (guvohnoma/ishonchnoma/shartnoma) to'liqmi
  const docsMissing = fr.docs?.missing ?? [];
  const docsTip = docsOk
    ? t('Firma hujjatlari to‘liq: guvohnoma, ishonchnoma, shartnoma')
    : `${t('Firma hujjatlari yetishmaydi:')} ${docsMissing.join(', ')}. ${t('Firmalar → firma → «Hujjatlar»dan yuklang. To‘liq bo‘lmaguncha sudga yuborib bo‘lmaydi.')}`;

  // ⋮ menyu (qo'shimcha amallar) + hisobot modali. Detalni kamaytirish: asosiy son/tugma
  // ko'rinadi, qolgani menyuda.
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false); // «Yuborilayotganlar» (navbat/holat) modali
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [menuOpen]);
  // ZIP faol/tayyor bo'lsa qatorda ko'rinadi (progress/yuklab olish); aks holda «boshlash» menyuda.
  const zipShown = !!zipJob;
  // Qoralama partiyasi FAOL bo'lsa — progressi qatorda; aks holda boshlash menyuда.
  const jobActive = !!job && (job.status === 'PENDING' || job.status === 'RUNNING');
  // Tugagan/yiqilgan partiya NATIJASI ham qatorda qoladi (2026-09-19): ilgari ExportControl faqat
  // faol paytda chizilardi va «N ta tayyorlandi / M ta XATO» hisobot hech qachon ko'rinmasdi.
  // Route xatosi (409/400 — jobId 0, FAILED) ham shu yerda ko'rinadi.
  const jobShown = !!job;

  return (
    <div className={`animate-fade-in rounded-xl border bg-surface transition-colors ${docsOk ? 'border-line hover:border-brand-500/40' : 'border-amber-500/40 bg-amber-500/[0.03]'}`} style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}>
      {/* BARQAROR 3 ZONA: [halqa] [nom + sonlar] [amallar].
          Ilgari bu `flex flex-wrap` edi va amallar matn oqimida suzardi: BRIGHT qatoriga
          tugma ostida bitta izoh qo'shilishi bilan butun klaster siljib, pastdagi
          COMMUNITY/URBAN tugmalari bilan ustma-ust tushmay qolardi (2026-09-07 skrinshot).
          Grid'da o'ng ustun kengligi qat'iy — qatorda nima bo'lishidan qat'i nazar
          tugmalar hamma firmada BIR CHIZIQDA turadi. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 p-3">
        <div className="pt-0.5"><ReadinessRing pct={pct} /></div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`truncate font-semibold ${docsOk ? '' : 'text-muted'}`} title={fr.firmName}>{fr.firmName}</span>
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted">{n(fr.total)} {t('jami')}</span>
            {/* Firma hujjatlari holati — ustiga borilsa qaysilari kerak/yetishmayotgani ko'rinadi. */}
            <span
              title={docsTip}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${docsOk ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'}`}
            >
              {docsOk
                ? <><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>{t('Hujjatlar')}</>
                : <><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>{t('Hujjat yetishmaydi')}</>}
            </span>
          </div>
          {/* Yetishmagan firma hujjatlari — aniq qaysilari (rasmga mos: guvohnoma/ishonchnoma/shartnoma). */}
          {!docsOk && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
              {FIRM_DOCS_ALL.map((k) => {
                const miss = docsMissing.includes(k);
                return (
                  <span key={k} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${miss ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`} title={miss ? `${t(k)} ${t('yetishmaydi')}` : `${t(k)} ${t('bor')}`}>
                    {miss ? '✕' : '✓'} {t(k)}
                  </span>
                );
              })}
              <span className="text-muted">{t('— Firmalar boʻlimidan yuklang')}</span>
            </div>
          )}
          {/* Firma qatorida FAQAT ish oqimiga aloqador holatlar: Tayyor emas · Tayyor · Qoralama · Sudda.
              «Chiqarilgan» (ZIP olingan) ATAYIN yo'q — u sudga yuborishga ta'sir qilmaydi (ZIP olingan ish
              baribir «Tayyor»da qoladi) va qatorda faqat chalg'itardi. Batafsil ko'rish kerak bo'lsa,
              «Batafsil» ochilganda tab sifatida chiqadi.
              «Batafsil» YOPIQ paytda ko'rinadi (ochiq bo'lsa xuddi shu tab'lar pastda chiqadi). */}
          {/* Chiplar GRID'da: ustunlar hamma firma qatorida BIR CHIZIQDA turadi, ya'ni
              «Tayyor 491» va pastdagi «Tayyor 164» ko'z bilan solishtiriladi. Ilgari ular
              matn oqimi bo'ylab joylashardi va har firmada boshqa joydan boshlanardi.
              Birinchi ustun kengroq: «Tayyor emas» eng uzun yorliq va eng katta son
              (4 xonali) — teng ustunlarda u yagona bo'lib qirqilardi.
              Besh ustunga o'tish `2xl` da: 1280px da beshtasi siqilib «Tayyo… / Nedb…»
              bo'lib qirqilardi, shuning uchun undan pastda 2–3 ustun. */}
          {!drillOpen && (
            // «Navbatda» ustuni FAQAT navbatda ish bo'lganda chiqadi — bo'sh paytda u har
            // qatorda «Navbatda 0» bo'lib bekorga joy egallardi. Qaror BUTUN RO'YXAT uchun
            // bir marta qabul qilinadi (`showQueued`), firma bo'yicha emas: aks holda bir
            // firmada 4, boshqasida 5 ustun bo'lib, qatorlar tekislanmay qolardi.
            <div className={`mt-2 grid max-w-[40rem] grid-cols-2 gap-1.5 sm:grid-cols-3 ${showQueued ? '2xl:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]' : '2xl:grid-cols-[1.3fr_1fr_1fr_1fr]'}`}>
              {FIRM_STAT_CHIPS.filter((f) => f.key !== 'queued' || showQueued).map((f) => (
                <span key={f.key} className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-[11px] font-medium" title={t(f.label)}>
                  <span className={`shrink-0 ${f.iconCls}`}>{f.icon}</span>
                  <span className="truncate text-muted">{t(f.label)}</span>
                  {/* «Sudda» ATAYIN ikki qismga bo'linadi: `50+120`.
                      Chapdagi — BIZ yuborganlar, o'ngdagi kichikroq va boshqa rangdagi —
                      yurist ADOLAT'da QO'LDA kiritganlari. Ular ham sudda, ya'ni qayta
                      yuborilmaydi, lekin manbasi boshqa: operator qaysi raqam nimadan
                      kelganini bir qarashda ko'rishi kerak (2026-09-08 operator so'rovi). */}
                  {f.key === 'submitted' && fr.submittedExternal > 0 ? (
                    <span className="ml-auto shrink-0 tabular-nums">
                      <span className="font-semibold">{n(fr.submitted - fr.submittedExternal)}</span>
                      <span
                        className="text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                        title={`+${n(fr.submittedExternal)} ${t("tasini yurist ADOLAT'da QO'LDA kiritgan — tizim yubormagan. Ular qayta yuborilmaydi. Chapdagi son — tizim yuborganlari.")}`}
                      >+{n(fr.submittedExternal)}</span>
                    </span>
                  ) : (
                    <span className="ml-auto shrink-0 font-semibold tabular-nums">{n(firmStatValue(fr, f.key))}</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* O'NG USTUN — barcha amallar shu yerda, qat'iy minimal kenglik bilan.
            Tugma ostidagi izohlar ham SHU ustun ichida qoladi, ya'ni ular qatorni
            kengaytirmaydi va qo'shni qatorlarni siljitmaydi. */}
        {/* Eni QAT'IY: `minWidth` faqat pastki chegara edi, ya'ni ustun matn uzayganda
            baribir cho'zilib firma nomi/chiplarini siqardi («#248 ketmoqda — yangi partiya
            undan keyin boshlanadi» chiqqanda layout buzilardi). `w-` + `max-w-full`:
            keng ekranda hamma firmada tugmalar bir chiziqda, tor ekranda esa ustun
            konteynerdan chiqib ketmaydi. */}
        {/* O'NG USTUN — faqat ASOSIY amal + ⋮ menyu. Qolgan amallar (batafsil, hisobot, ZIP)
            menyu ichida — qator tozalanadi, sonlar ko'zга tawlanadi. */}
        <div className="flex shrink-0 items-center justify-end gap-2">
          {/* Brauzerdagi «Auto» (partiyalarni ketma-ket davom ettirish) OLIB TASHLANDI (2026-09-19):
              u server «Go — 24/7» ning takrori edi, sahifa yangilansa yo'qolardi va real yuborishga
              ham o'tib ketishi mumkin edi. Endi uzluksiz qoralama — faqat Go. */}
          {/* Qoralama partiyasi (faol yoki tugagan natijasi) va ZIP holati qatorda ko'rinadi.
              Boshlash amallari ⋮ menyuда — qator toza turadi. */}
          {docsOk && jobShown && <ExportControl job={job} sendable={fr.sendable} onStart={() => startExport(fr.firmId, {})} batchActive={batchActive} />}
          {docsOk && zipShown && <ZipControl job={zipJob} sendable={fr.sendable} onStart={() => onZip?.()} onCancel={onZipCancel} />}
          {!docsOk && (
            <button type="button" disabled title={docsTip}
              className={`${ROW_BTN} border border-amber-500/40 bg-amber-500/10 text-amber-700 opacity-90 dark:text-amber-300`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              {t('Hujjat kerak')}
            </button>
          )}

          {/* ⋮ MENYU — asosiy amal (Qoralama tayyorlash) + batafsil / navbat / hisobot / ZIP */}
          <div ref={menuRef} className="relative shrink-0">
            <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-haspopup="menu" title={t('Amallar')}
              className={`inline-flex ${ROW_H} w-9 items-center justify-center rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/30 ${menuOpen || drillOpen ? 'border-brand-500/40 bg-surface-2 text-fg' : 'border-line text-muted hover:border-brand-500/40 hover:bg-surface-2 hover:text-fg'}`}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-xl">
                {/* ASOSIY: Qoralama tayyorlash — DOIM ko'rinadi (tayyorlanayotganda «ketyapti N/M»). Ikonsiz.
                    Real yuborish bu yerda YO'Q — faqat «Sudga o'tkazish» tabida (E-IMZO bilan). */}
                {docsOk && (
                  <>
                    <button type="button" role="menuitem" onClick={() => { startExport(fr.firmId, {}); setMenuOpen(false); }}
                      className={`${MENU_ITEM} justify-between font-semibold text-emerald-700 dark:text-emerald-300`} disabled={fr.sendable <= 0 && !jobActive}
                      title={fr.sendable > 0 ? t('Soni so‘raladi — ADOLAT «Murojaatlarim»da qoralama (sudga yuborilmaydi)') : jobActive ? t('Ayni damda tayyorlanmoqda') : t('Qoralamaga tayyor ish yo‘q')}>
                      <span>{t('Qoralama tayyorlash')}{fr.sendable > 0 ? ` (${n(fr.sendable)})` : ''}</span>
                      {jobActive && job && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" /> {t('ketyapti')} {n(job.progress ?? 0)}/{n(job.total ?? 0)}
                        </span>
                      )}
                    </button>
                    <div className="my-1 border-t border-line/60" />
                  </>
                )}
                <button type="button" role="menuitem" onClick={() => { if (!drillOpen) onToggleDrill(); setMenuOpen(false); }} className={MENU_ITEM}>
                  {t('Mijozlar (batafsil)')}
                </button>
                <button type="button" role="menuitem" onClick={() => { setQueueOpen(true); setMenuOpen(false); }} className={`${MENU_ITEM} justify-between`}>
                  <span>{t('Navbat holati')}</span>
                  {jobActive && <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" /> {t('ketyapti')}</span>}
                </button>
                <button type="button" role="menuitem" onClick={() => { setReportOpen(true); setMenuOpen(false); }} className={MENU_ITEM}>
                  {t('Hisobot')}
                </button>
                {docsOk && !zipShown && (
                  <button type="button" role="menuitem" onClick={() => { onZip?.(); setMenuOpen(false); }} className={MENU_ITEM} title={t('Hujjatlarni bitta arxivga — sudga YUBORMAYDI')}>
                    {t('ZIP — hujjatlarni yuklab olish')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* NAVBAT holati — alohida MODALда (qator ostида emas).
          Xato sabablari, progress, davom ettirish — hammasi shu modalда. */}
      {queueOpen && (
        <Modal open onClose={() => setQueueOpen(false)} title={`${t('Navbat holati —')} ${fr.firmName}`} size="lg">
          <QueuePanel firmId={fr.firmId} live onChanged={onChanged} />
        </Modal>
      )}
      {/* MIJOZLAR (batafsil) — endi MODALда (qator ostида emas). */}
      {drillOpen && (
        <Modal open onClose={onToggleDrill} title={`${t('Mijozlar —')} ${fr.firmName}`} description={`${n(fr.total)} ${t('ta ish')} · ${n(fr.sendable)} ${t('tayyor')}`} size="xl">
          {/* suitMode — Go bilan bir xil «Murojaatlarim» qoralamasi (ilgari draftMode: eski stop-A). */}
          <ClientDrilldown firmId={fr.firmId} snapshotId={snapshotId} job={job} startExport={(caseIds) => startExport(fr.firmId, { caseIds, suitMode: true })} onChanged={onChanged} batchActive={batchActive} />
        </Modal>
      )}

      {/* HISOBOT modali — firma tayyorligi tafsiloti (⋮ menyudan ochiladi). */}
      {reportOpen && (
        <Modal open onClose={() => setReportOpen(false)} title={`${t('Hisobot —')} ${fr.firmName}`} description={`${t('Jami')} ${n(fr.total)} ${t('ta ish')}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { label: 'Tayyor emas', value: fr.total - fr.ready, cls: 'text-rose-600 dark:text-rose-400' },
                { label: 'Tayyor', value: fr.sendable, cls: 'text-emerald-600 dark:text-emerald-400' },
                { label: 'Qoralama tayyor', value: fr.draftReady, cls: 'text-teal-600 dark:text-teal-400' },
                { label: 'Navbatda', value: fr.queued, cls: 'text-amber-600 dark:text-amber-400' },
                { label: 'Sudda (tizim)', value: fr.submitted - fr.submittedExternal, cls: 'text-indigo-600 dark:text-indigo-400' },
                { label: 'Sudda (yurist qo‘lda)', value: fr.submittedExternal, cls: 'text-amber-600 dark:text-amber-400' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <div className="text-[11px] text-muted">{t(s.label)}</div>
                  <div className={`text-lg font-semibold tabular-nums ${s.cls}`}>{n(s.value)}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-muted">{t('Yetishmayotgan hujjatlar (ish soni)')}</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {([['Talabnoma', 'talabnoma'], ['Skan', 'scan'], ['Oferta', 'oferta'], ['Chek', 'receipt'], ['Boji', 'boji']] as const).map(([lbl, k]) => (
                  <div key={k} className="rounded-lg bg-surface-2 px-2 py-1.5 text-[11px]">
                    <div className="text-muted">{t(lbl)}</div>
                    <div className={`font-semibold tabular-nums ${fr.missing[k] ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{n(fr.missing[k])}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-muted">{t('1 qadam qolgan (aynan bittasi yetishmaydi)')}</div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {([['Talabnoma', 'talabnoma'], ['Skan', 'scan'], ['Oferta', 'oferta'], ['Chek', 'receipt'], ['Boji', 'boji']] as const)
                  .filter(([, k]) => fr.almost[k] > 0)
                  .map(([lbl, k]) => (
                    <span key={k} className="rounded bg-amber-500/15 px-2 py-1 font-medium text-amber-700 dark:text-amber-300">{t(lbl)}: {n(fr.almost[k])}</span>
                  ))}
                {(fr.almost.talabnoma + fr.almost.scan + fr.almost.oferta + fr.almost.receipt + fr.almost.boji) === 0 && <span className="text-muted">{t('Yo‘q')}</span>}
              </div>
            </div>

            <div className={`rounded-lg border px-3 py-2 text-[11px] ${docsOk ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-amber-500/40 bg-amber-500/[0.05]'}`}>
              <span className="font-semibold">{t('Firma hujjatlari:')} </span>
              {docsOk ? t('to‘liq (guvohnoma, ishonchnoma, shartnoma)') : `${t('yetishmaydi —')} ${docsMissing.join(', ')}`}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EmptyBlock({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-line bg-surface px-3 py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </div>
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="max-w-md text-xs text-muted">{hint}</div>}
      </div>
    </div>
  );
}

// ── draft-auto (24/7 «Go») holati — HeaderShell.running / notice va FirmQueue rows uchun ──
// 2026-09-20: ilgari mustaqil DraftAutoPanel edi. Endi shu fayl ichida, chunki uning
// ma'lumoti (aktiv partiya + har firma paused/lastBatch/sendable) toolbar va firm-queue
// bilan bitta ekran ustida ishlaydi — ikkita komponent bir manbani takrorlab kelardi.
type DraftJobKind = 'draft' | 'suit' | 'real' | 'send';
interface DraftLastBatch { jobId: number; kind: DraftJobKind; status: string; message: string | null; total: number; progress: number; finishedAt: string }
interface DraftFirmRow { firmId: number; firmName: string; total: number; draftReady: number; submitted: number; queued: number; sendable: number; active: boolean; paused: boolean; lastBatch?: DraftLastBatch | null }
interface DraftAutoStatus {
  on: boolean;
  active: { jobId: number; status: string; progress: number; total: number; firmId: number | null; firmName: string | null; kind?: DraftJobKind | null; draftMode: boolean; message: string | null } | null;
  firms: DraftFirmRow[];
  backoff?: { nextAttemptAt: string | null };
}
// Oxirgi partiya XATO deb hisoblanishi (Go monitoringi bilan bir xil): FAILED = fatal;
// DONE + xabarda «XATO» — qisman.
function isBatchFailed(b: DraftLastBatch): boolean {
  if (b.status === 'FAILED') return true;
  return b.status !== 'CANCELED' && /XATO/i.test(b.message ?? '');
}
function useDraftAuto(active: boolean) {
  const [data, setData] = useState<DraftAutoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/konveyer/court-draft-auto', { cache: 'no-store' });
      if (!r.ok) return;
      setData(await r.json());
    } catch { /* tarmoq — keyingi pollда qayta o'qiladi */ }
  }, []);
  useEffect(() => {
    if (!active) return;
    void load();
    // 12s — asosiy court-ready (20s) bilan taqqoslanadi. Yashirin oynada so'ramaymiz.
    const id = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void load(); }, 12_000);
    return () => clearInterval(id);
  }, [load, active]);
  const toggle = useCallback(async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/konveyer/court-draft-auto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: !data.on }),
      });
      if (r.ok) { const d = await r.json(); setData((p) => (p ? { ...p, on: d.on === true } : p)); }
    } catch { /* tarmoq — holat o'zgarmaydi */ } finally { setBusy(false); void load(); }
  }, [data, busy, load]);
  // Bitta firmani to'xtatish/davom ettirish (umumiy Go bilan mustaqil). Pauzaga qo'yilgan
  // firma avto-qoralamada chetlab o'tiladi — boshqa firmalar ketaveradi.
  const setFirmPaused = useCallback(async (firmId: number, paused: boolean) => {
    // Optimistik ko'rsatamiz — server javobini kutmasdan.
    setData((p) => (p ? { ...p, firms: p.firms.map((f) => (f.firmId === firmId ? { ...f, paused } : f)) } : p));
    try {
      await fetch('/konveyer/court-queue/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused, firmId }),
      });
    } catch { /* tarmoq — keyingi pollда to'g'rilanadi */ } finally { void load(); }
  }, [load]);
  return { data, busy, load, toggle, setFirmPaused };
}

// Partiya turi yorlig'i — HeaderShell.running.kindLabel va FirmQueue.running.kindLabel uchun.
// «qoralama tayyorlash» — Go yoki qo'lda suit; «Sudga o'tkazish» — send; boshqasi — real.
const KIND_LABEL: Record<DraftJobKind, string> = {
  suit: 'qoralama tayyorlash', draft: 'qoralama tayyorlash', send: 'Sudga o‘tkazish', real: 'sudga real yuborish',
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// ── main ─────────────────────────────────────────────────────────────────────
// «Qoralama (1 qadam)» tabi (/sud, 2026-09-19): FAQAT qoralama — Tayyor ishlar uchun ADOLAT
// «Murojaatlarim»da suit (suitMode) tayyorlanadi, sudga YUBORILMAYDI. Real yuborish yo'li bu
// komponentdan butunlay olib tashlandi (u «Sudga o'tkazish» tabida, saqlangan suit'ni E-IMZO bilan).
//   • initialFirmId / onFirmChange — firma filtri URL (?firm=) bilan sinxron (SudTabs);
//   • onData — har yuklangan court-ready javobi (SudTabs yuqoridagi 5 bosqich sonlari uchun).
// `tab` — eski prop (faqat 'send'); o'lik «stat»/«returns» shoxlari olib tashlandi.
export function CourtManager({ firms, selectedId, initialData, initialFirmId, onFirmChange, onData, active = true }: {
  firms: { firmId: number; firmName: string; total: number; stir?: string | null }[]; selectedId?: number; initialData?: Data | null; tab?: 'send';
  initialFirmId?: number | null; onFirmChange?: (firmId: number | null) => void; onData?: (d: CourtData) => void;
  /** Shu tab ko'rinib turibdimi (SudTabs). Yashirin bo'lsa davriy so'rovlar to'xtaydi; job kuzatuvi davom etadi. */
  active?: boolean;
}) {
  const t = useT();
  const confirmQ = useConfirm(); // navbatni to'xtatish/tozalash — qaytarib bo'lmaydigan amallar
  const [firmId, setFirmId] = useState<number | null>(initialFirmId ?? null);
  // Firma URL'dan (SudTabs, ?firm=) o'zgarsa — shu tab ham o'sha firmaga o'tadi (boshqa tablar bilan
  // bir xil firma; ilgari faqat boshlang'ich qiymat o'qilardi — 2026-09-19 kod ko'rigi).
  useEffect(() => { setFirmId(initialFirmId ?? null); }, [initialFirmId]);
  const [data, setData] = useState<Data | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [openFirm, setOpenFirm] = useState<number | null>(null);
  const [xlsOpen, setXlsOpen] = useState(false); // Excel eksportlari menyusi
  // NAVBAT SAHIFA YANGILANGANDA YO'QOLMASIN. Partiya ro'yxati faqat React state'da edi —
  // reload'da yo'qolardi va operator navbat bekor bo'ldi deb o'ylardi. Aslida har ishning
  // holati bazada (CourtQueueItem), shuning uchun navbat SHUNDAN tiklanadi.
  const [pendingQ, setPendingQ] = useState<{ firmId: number; firmName: string; stir: string | null; pending: number; running: number; done: number; failed: number; skipped: number; job?: { jobId: number; status: string; progress: number; total: number; queuePos: number; message?: string | null } | null }[]>([]);
  const loadPending = useCallback(() => {
    fetch('/konveyer/court-queue/pending')
      .then((r) => r.json())
      .then((d) => setPendingQ(Array.isArray(d?.firms) ? d.firms : []))
      .catch(() => { /* tarmoq xatosi — keyingi tsiklda qayta o'qiladi */ });
  }, []);
  useEffect(() => {
    if (!active) return;
    loadPending();
    const t = setInterval(() => { if (!document.hidden) loadPending(); }, 10_000);
    return () => clearInterval(t);
  }, [loadPending, active]);
  const reqRef = useRef(0);
  const loadedOnce = useRef(!!initialData);
  // The page server-renders the initial (firm=all) payload → skip the duplicate mount fetch.
  const skipMount = useRef(!!initialData);
  // Yuqoridagi 5 bosqich (SudTabs) shu ma'lumotdan sanaladi — har yangilanishda xabar beramiz.
  const onDataRef = useRef(onData);
  useEffect(() => { onDataRef.current = onData; });
  useEffect(() => { if (data) onDataRef.current?.(data); }, [data]);

  // lifted export-job state — survives firm-filter / tab switches (a running or finished
  // export is never silently lost when a firm row unmounts).
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  useEffect(() => () => { Object.values(timers.current).forEach(clearInterval); }, []);

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    if (!loadedOnce.current) setLoading(true); else setRefreshing(true);
    setError(null);
    const qs = new URLSearchParams();
    if (firmId) qs.set('firmId', String(firmId));
    if (selectedId) qs.set('s', String(selectedId));
    try {
      const d = await getJson(`/konveyer/court-ready?${qs.toString()}`, { cache: 'no-store' }, t);
      if (my !== reqRef.current) return null;
      setData(d); setLastLoaded(new Date()); loadedOnce.current = true;
      return d as Data;
    } catch (e) {
      if (my !== reqRef.current) return null;
      setError(e instanceof Error ? e.message : t('Yuklab boʻlmadi')); // keep stale data — no setData(null)
      return null;
    } finally { if (my === reqRef.current) { setLoading(false); setRefreshing(false); } }
  }, [firmId, selectedId]);
  useEffect(() => { if (skipMount.current) { skipMount.current = false; return; } load(); }, [load]);
  // Stamp the SSR-seeded data's "updated" time AFTER mount — computing new Date() during
  // render would differ between server HTML and client hydration (a text mismatch).
  useEffect(() => { if (initialData) setLastLoaded(new Date()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Live ref to load: a long-running export's completion callback must refresh the
  // CURRENTLY-viewed firm, not the firm that was selected when the export started
  // (otherwise finishing firm A's export while viewing firm B overwrites B with A's data).
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  // Partiya ketayotganda YUQORIDAGI raqamlarni ham yangilab turamiz.
  //
  // Nega: firma qatoridagi «Sudda / Tayyor / Chiqarilgan» sahifa ochilganda bir marta
  // yuklanadi, navbat paneli esa har 5 soniyada yangilanadi. Partiya soatlab ketgani uchun
  // ular bir-biridan uzoqlashib, ekranda «Sudda 30» va «60 ketdi» degan qarama-qarshi
  // raqamlar ko'rinardi (2026-09-07). Ma'lumot to'g'ri edi — faqat biri eskirgan edi.
  const anyJobRunning = Object.values(jobs).some((j) => j.status === 'PENDING' || j.status === 'RUNNING');
  // SHU BRAUZERDA boshlanmagan partiyalar ham hisobga olinadi.
  //
  // `jobs` — faqat shu oynadan boshlangan ishlar. Partiya esa worker'da o'zi boshlanadi
  // (avtomat davom ettirish) yoki boshqa oynadan boshlanadi. Bunday paytda yuqoridagi
  // «Sudda / Tayyor / Chiqarilgan» raqamlari butun partiya davomida QOTIB turardi, pastdagi
  // navbat paneli esa har 4 soniyada o'sib borardi — ekranda ikki xil haqiqat.
  // `pendingQ` (har 10 s) serverdagi faol partiyani biladi, shundan foydalanamiz.
  const serverBatchRunning = pendingQ.some((q) => q.job && (q.job.status === 'RUNNING' || q.job.status === 'PENDING'));
  const numbersLive = anyJobRunning || serverBatchRunning;
  useEffect(() => {
    if (!numbersLive || !active) return;
    const t = setInterval(() => { if (!document.hidden) void loadRef.current(); }, 20_000);
    return () => clearInterval(t);
  }, [numbersLive, active]);

  // `endpoint` — odatda partiya tanlash (prepare-ready), lekin navbatni DAVOM ETTIRISHDA
  // boshqa yo'l ishlatiladi (court-queue/resume): u yangi tanlov qilmaydi, bazadagi PENDING
  // ishlarni oladi. Shuning uchun manzil parametr bo'ldi.
  // Bitta job'ni kuzatish. `startJob` dan AJRATILDI, chunki uni ikki joy ishlatadi:
  // yangi boshlangan job va sahifa yangilangach BAZADAN topilgan, allaqachon ketayotgan job.
  const pollJob = useCallback((key: string, jobId: number, onDone: () => void) => {
    if (timers.current[key]) return;
    let pollFails = 0;
    // KUZATUV TASLIM BO'LMAYDI.
    //
    // Ilgari ketma-ket 5 marta (~10 soniya) yiqilsa poller BUTUNLAY to'xtardi. 10 soniyalik
    // tarmoq g'ijimi — ish ketayotgan 10 daqiqalik ZIP uchun hech narsa emas, lekin karta
    // shu joyda muzlab qolardi va boshqa hech qachon yangilanmasdi: operator serverda ish
    // muvaffaqiyatli tugaganini ko'rmasdi ham. Endi poller cheksiz davom etadi, faqat
    // tezligini pasaytiradi (2s → 10s) va aloqa yo'qligini OCHIQ aytadi; aloqa tiklangach
    // ogohlantirish o'zi yo'qoladi.
    const FAST_MS = 2000, SLOW_MS = 10_000, WARN_AFTER = 5;
    let period = FAST_MS;
    const tick = async () => {
      try {
        const s = await getJson(`/api/jobs/${jobId}`, undefined, t);
        const wasFailing = pollFails >= WARN_AFTER;
        pollFails = 0;
        if (period !== FAST_MS) { period = FAST_MS; schedule(); }
        setJobs((j) => (j[key]
          ? { ...j, [key]: { ...j[key], status: s.status, progress: s.progress, total: s.total, message: s.message ?? undefined, ...(wasFailing ? { error: undefined } : {}) } }
          : j));
        if (s.status === 'DONE' || s.status === 'FAILED' || s.status === 'CANCELED') {
          clearInterval(timers.current[key]); delete timers.current[key];
          if (s.status === 'DONE') onDone();
        }
      } catch (e) {
        if (++pollFails === WARN_AFTER) {
          const msg = e instanceof Error ? e.message : t('Holatni o‘qib bo‘lmadi');
          // Ish SERVERDA davom etyapti — bu faqat ko'rsatkich uzilgani.
          setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], error: `${msg} ${t('— aloqa tiklanishi kutilmoqda (ish serverda davom etyapti)')}` } } : j));
        }
        if (pollFails >= WARN_AFTER && period !== SLOW_MS) { period = SLOW_MS; schedule(); }
      }
    };
    const schedule = () => {
      clearInterval(timers.current[key]);
      timers.current[key] = setInterval(tick, period);
    };
    schedule();
  }, []);

  const startJob = useCallback((key: string, body: Record<string, unknown>, onDone: () => void, endpoint = '/konveyer/prepare-ready') => {
    if (timers.current[key]) return; // already running
    setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'PENDING', progress: 0, total: 0 } }));
    // TUGAGAN SESSIYA «Tarmoq xatosi» BO'LIB KO'RINMASIN.
    //
    // Sessiya tugaganda server login sahifasiga yo'naltiradi, brauzer esa uni kuzatib
    // 200 + HTML oladi: `r.json()` «Unexpected token '<'» bilan yiqiladi va quyidagi
    // .catch hamma narsani «Tarmoq xatosi» deb yozardi. Operator ZIP tugmasini qayta-qayta
    // bosardi, holbuki qilishi kerak bo'lgan yagona ish — qaytadan kirish (2026-09-08).
    // Sabab getJson() dagi bilan BIR XIL usulda aniqlanadi (content-type + redirect).
    let failMsg = t('Tarmoq xatosi');
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => {
        const ct = r.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) {
          failMsg = r.redirected || r.url.includes('/login')
            ? t('Sessiya tugagan — sahifani yangilab, qaytadan kiring.')
            : `${t('Server JSON qaytarmadi')} (${r.status}). ${t('Sahifani yangilab ko‘ring.')}`;
          throw new Error(failMsg);
        }
        return r.json().then((d) => ({ ok: r.ok, d }));
      })
      .then(({ ok, d }) => {
        if (!ok) { setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'FAILED', progress: 0, total: 0, error: d?.error || t('Xatolik') } })); return; }
        // `asked` — operator NECHTA so'ragani. Server topgani (`d.total`) undan kam bo'lishi
        // mumkin (masalan tayyorlari kamaygan). Ilgari bu farq jim yo'qolardi va operator
        // «616 so'ragandim, nega 100?» degan savol bilan qolardi.
        const asked = typeof body.limit === 'number' ? (body.limit as number) : undefined;

        // PARTIYA YARATILMAGAN, LEKIN ISH YO'QOLMAGAN.
        //
        // Sud kunlik limiti tugagan bo'lsa server bugun partiya ochmaydi — o'rniga ishlarni
        // navbatga yozib, `jobId: null` bilan qaytaradi. Bu XATO EMAS: ular keyingi ish
        // kunida worker tomonidan o'zi yuboriladi. Ilgari bunday javob 400 edi va navbat
        // yozuvi qizil «xato» bo'lib qotib qolardi.
        if (!d.jobId) {
          setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'DONE', progress: 0, total: Number(d.queued) || 0, type: 'COURT_SUBMIT', asked, message: d.message || t('Navbatga qo‘yildi') } }));
          void loadRef.current();
          onDone();
          return;
        }
        setJobs((j) => ({ ...j, [key]: { jobId: d.jobId, status: 'PENDING', progress: 0, total: d.total, type: d.type, asked, deferred: Number(d.deferred) || undefined } }));
        // RAQAMLAR DARHOL YANGILANSIN. Partiyaga olingan ishlar shu zahoti «Tayyor»dan
        // «Navbatda»ga o'tadi — server allaqachon shunday hisoblaydi, faqat sahifadagi
        // nusxa eski qolardi. Ilgari u faqat 20 soniyalik davriy yangilanishda tuzatilardi
        // va shu oraliqda operator «291 ta tayyor» ni ko'rib turardi, holbuki 200 tasi
        // allaqachon navbatda edi (2026-09-07).
        void loadRef.current();
        pollJob(key, d.jobId, onDone);
      })
      // Sabab ANIQ bo'lsa (sessiya/HTML javob) — o'shani yozamiz; qolgan hamma holat
      // (haqiqiy uzilish, brauzerning inglizcha `Failed to fetch` xabari) «Tarmoq xatosi».
      .catch(() => setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'FAILED', progress: 0, total: 0, error: failMsg } })));
  }, [pollJob]);

  // KETAYOTGAN ZIP SAHIFA YANGILANGANDA YO'QOLMASIN.
  //
  // ZIP holati faqat brauzer xotirasida edi: F5 bosilsa progress kartasi butunlay
  // g'oyib bo'lardi, ish esa serverda davom etardi. Operator uni ko'ra ham, bekor ham
  // qila olmasdi va yangi ZIP bosib ustiga ikkinchisini qo'shib yuborardi.
  // Job'lar bazada — shundan tiklaymiz (sud navbati bilan bir xil qoida).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await getJson('/api/jobs?type=PACKET&limit=30', undefined, t);
        // `jobs` — API'ning HAQIQIY maydoni (route.ts: `NextResponse.json({ jobs: rows })`).
        // Bu yerda `d.rows` o'qilardi, ya'ni ro'yxat HAR DOIM bo'sh chiqib, tiklash kodi
        // hech qachon ishlamagan: F5 bosilsa ketayotgan ZIP kartasi butunlay yo'qolardi.
        // `rows` — eski javob shakli uchun zaxira (ikkalasi ham qabul qilinadi).
        const list = Array.isArray(d?.jobs) ? d.jobs : Array.isArray(d?.rows) ? d.rows : null;
        if (!alive || !list) return;
        const seen = new Set<number>();
        for (const r of list) {                         // eng yangisidan (createdAt desc)
          const fid = Number(r?.firmId);
          if (!Number.isInteger(fid) || fid <= 0 || seen.has(fid)) continue;
          seen.add(fid);
          if (r.status !== 'PENDING' && r.status !== 'RUNNING') continue;
          const key = `zip:${fid}`;
          setJobs((j) => (j[key] ? j : { ...j, [key]: { jobId: r.id, status: r.status, progress: r.progress, total: r.total, type: 'PACKET' } }));
          pollJob(key, r.id, () => { void loadRef.current(); });
        }
      } catch { /* tiklash ixtiyoriy — xato bo'lsa oddiy holatda qolamiz */ }
    })();
    return () => { alive = false; };
  }, [pollJob]);

  // ZIP'ni to'xtatish. Server yarim tayyor arxivni o'chiradi va job CANCELED bo'ladi.
  const cancelJob = useCallback(async (key: string, jobId: number) => {
    try { await fetch(`/api/jobs/${jobId}`, { method: 'POST' }); } catch { /* poll baribir ko'radi */ }
    setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], message: 'Bekor qilinmoqda…' } } : j));
  }, []);

  const snapshotId = data?.snapshotId ?? selectedId;

  // Brauzer «Auto» rejimi (AUTO_MS bilan keyingi partiya) 2026-09-19 da OLIB TASHLANDI: server
  // «Go — 24/7» (DraftAutoPanel) aynan shu ishni qiladi, sahifa yopilsa ham, va real yuborishga
  // o'tib ketish xavfi yo'q. Bu yerda endi faqat bitta partiya.

  // Navbatni davom ettirish — kalit bilan tasdiqlanadi (sessiyani yangilaydi), so'ng bazadagi
  // PENDING ishlardan yangi partiya boshlanadi (o'z rejimida — resume route real'ni olmaydi).
  const runResume = (fid: number) =>
    startJob(`firm:${fid}`, { firmId: fid, limit: MAX_COURT_BATCH }, () => { void loadRef.current(); loadPending(); }, '/konveyer/court-queue/resume');

  // QORALAMA partiyasi — HAR DOIM suitMode (Go bilan bir xil: save-suit → «Murojaatlarim», send
  // YO'Q). `extra` dagi har qanday draftMode/auto e'tiborsiz: prepare-ready bayroqsiz so'rovni
  // (real yuborish) endi 400 bilan rad etadi, draftMode (stop-A) esa 3-tabga o'tmaydi.
  const runExport = (fid: number, extra: Record<string, unknown> = {}) => {
    const { draftMode: _dm, auto: _au, ...rest } = extra as { draftMode?: unknown; auto?: unknown } & Record<string, unknown>;
    void _dm; void _au;
    return startJob(`firm:${fid}`, { firmId: fid, snapshotId, limit: MAX_COURT_BATCH, ...rest, suitMode: true }, () => { void loadRef.current(); });
  };
  // ZIP — ALOHIDA job kaliti (`zip:<id>`). Sud partiyasi (`firm:<id>`) bilan bir kalitda edi:
  // ZIP bosilganda sud tugmasi «Yuborilmoqda»ga aylanib, navbat paneli jonlanib ketardi.
  // Endi ikkalasi bir vaqtda, bir-biriga xalaqit bermay ishlaydi.
  const runZip = (fid: number, limit: number) =>
    startJob(`zip:${fid}`, { firmId: fid, snapshotId, limit, exportOnly: true }, () => { void loadRef.current(); });

  // «Qoralama tayyorlash» → E-IMZO gate: aniq so'roq (summary) → firma kaliti → parol → tayyorlanadi.
  // Kalit nega kerak: u firma ADOLAT sessiyasini yangilaydi (qoralama ham portalga chiqadi).
  // (Bekor qilish kalit talab qilmaydi — u ClientDrilldown ichida oddiy tasdiq modali bilan.)
  const [gate, setGate] = useState<{ firmId: number; firmName: string; stir: string | null; extra: Record<string, unknown>; summary: string } | null>(null);
  // «Qoralama tayyorlash» (firma darajasida) → avval SONI so'raladi (max MAX_COURT_BATCH), keyin E-IMZO gate.
  // Drilldownда qo'lda tanlanган (caseIds) yoki soni allaqachon berilган bo'lsa — to'g'ridan gate.
  // Real yuborish rejimi (draftMode belgisini olib tashlash → boji to'langanlar, maxPaid) YO'Q — 2026-09-19.
  const [countAsk, setCountAsk] = useState<{ firmId: number; firmName: string; max: number; queued: number; value: number } | null>(null);
  // ZIP eksport modali — sudga YUBORMAYDI, faqat hujjatlarni bitta arxivga yig'adi.
  const [zipAsk, setZipAsk] = useState<{ firmId: number; firmName: string; max: number; value: number } | null>(null);
  const openGate = (fid: number, extra: Record<string, unknown> = {}) => {
    const f = firms.find((x) => x.firmId === fid);
    const ids = (extra as { caseIds?: unknown }).caseIds;
    const lim = (extra as { limit?: unknown }).limit;
    const cnt = Array.isArray(ids) ? ids.length : (typeof lim === 'number' ? lim : null);
    const act = t("ADOLAT «Murojaatlarim»da qoralama tayyorlanadi — sudga YUBORILMAYDI (keyin «Sudga o‘tkazish» tabidan)");
    setGate({
      firmId: fid, firmName: f?.firmName ?? `${t('Firma')} ${fid}`, stir: f?.stir ?? null, extra,
      summary: cnt != null ? `${cnt} ${t('ta mijoz uchun')} ${act}. ${t('Firma kaliti bilan tasdiqlang.')}` : `${t('Tayyor mijozlar uchun (bir martada ≤')}${MAX_COURT_BATCH}) ${act}. ${t('Firma kaliti bilan tasdiqlang.')}`,
    });
  };
  const startExport = (fid: number, extra: Record<string, unknown> = {}) => {
    const ids = (extra as { caseIds?: unknown }).caseIds;
    // Qo'lda tanlanган yoki soni berilган → to'g'ridan gate. Aks holda — soni so'raymiz.
    if (Array.isArray(ids) || (extra as { limit?: unknown }).limit != null) { openGate(fid, extra); return; }
    const fr = data?.readiness.firms.find((f) => f.firmId === fid);
    const max = Math.min(MAX_COURT_BATCH, fr?.sendable ?? 0);
    if (max <= 0) return; // tayyorlanadigan yo'q
    // Qoralama uchun boji TO'LOVI shart emas (faqat invoice raqami) → hamma tayyor.
    setCountAsk({ firmId: fid, firmName: fr?.firmName ?? `${t('Firma')} ${fid}`, max, queued: fr?.queued ?? 0, value: max });
  };

  // ── «Qoralama tayyorlash» modalidagi SUD taqsimoti (ko'rsatkich) ──────────────
  const [courtBreak, setCourtBreak] = useState<{ firmId: number; courts: { courtId: number | null; shortName: string; count: number; enabled?: boolean; note?: string | null }[]; total: number } | null>(null);
  // Operator tanlagan sudlar. null = hammasi (eski xatti-harakat, hech narsa cheklanmaydi).
  const [pickedCourts, setPickedCourts] = useState<number[] | null>(null);
  useEffect(() => {
    if (!countAsk) { setCourtBreak(null); return; }
    let alive = true;
    const qs = new URLSearchParams({ firmId: String(countAsk.firmId) });
    if (snapshotId) qs.set('s', String(snapshotId));
    fetch(`/konveyer/court-ready/courts?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive && d && Array.isArray(d.courts)) setCourtBreak({ firmId: countAsk.firmId, courts: d.courts, total: d.total ?? 0 }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [countAsk?.firmId, snapshotId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Yuborish NAVBATI — skayner kabi 2-3 partiya ketma-ket ────────────────────
  // Har item: firma + soni. Joriy (birinchi tugamagan) item bo'yicha holat-mashina:
  // yangi firma → E-IMZO gate (bir marta), imzolangan firma → to'g'ridan yuboriladi;
  // job DONE/FAILED bo'lgach keyingisiga o'tadi (FAILED'da ham to'xtab qolmaydi).
  // `error` — NEGA yiqilgani. Ilgari chipda faqat qizil «xato» so'zi turardi va operator
  // sababni topolmasdi (eng ko'p uchraydigani: «bu firmada partiya allaqachon ketmoqda»).
  // Har navbat yozuvi — QORALAMA partiyasi (suitMode); real yuborish navbatga tushmaydi (2026-09-19).
  type QItem = { id: string; firmId: number; firmName: string; stir: string | null; count: number; courtIds?: number[]; status: 'wait' | 'signing' | 'sending' | 'done' | 'error'; error?: string };
  const [queue, setQueue] = useState<QItem[]>([]);
  const [queueActive, setQueueActive] = useState(false);
  const signedFirms = useRef<Set<number>>(new Set());
  const [queueGate, setQueueGate] = useState<{ itemId: string; firmId: number; firmName: string; stir: string | null; count: number } | null>(null);
  const qidRef = useRef(0);
  // Navbatga qo'shilishi bilan navbat O'ZI yoqiladi.
  //
  // Ilgari operator ikki marta bosishi kerak edi: «+ Navbatga», keyin «Boshlash». Ketayotgan
  // partiya ustiga qo'shilganda esa bu ayniqsa noqulay edi — u qaytib kelib, tugaganini
  // ko'rib, keyin «Boshlash» bosishi kerak edi. Endi qo'shish = «shu ishlarni yubor»:
  // navbat bo'sh bo'lsa darhol boshlanadi, band bo'lsa o'z navbatini kutadi. To'xtatish
  // uchun navbat panelida «To'xtatish» bor.
  const addToQueue = (fid: number, fname: string, stir: string | null, count: number, courtIds?: number[]) => {
    setQueue((q) => [...q, { id: `q${++qidRef.current}`, firmId: fid, firmName: fname, stir, count, courtIds, status: 'wait' as const }]);
    setQueueActive(true);
  };

  // Har firma uchun serverda FAOL partiya (RUNNING yoki navbatda PENDING). Manba —
  // `pendingQ` (5 soniyada yangilanadi), ya'ni boshqa oynadan yoki avtomat davom
  // ettirishdan boshlangan partiya ham hisobga olinadi.
  const activeBatchByFirm = React.useMemo(() => {
    const m = new Map<number, { jobId: number; status: string; queuePos: number }>();
    for (const q of pendingQ) if (q.job) m.set(q.firmId, q.job);
    return m;
  }, [pendingQ]);

  useEffect(() => {
    if (!queueActive) return;
    const cur = queue.find((x) => x.status !== 'done' && x.status !== 'error');
    if (!cur) { setQueueActive(false); return; }
    if (cur.status === 'sending') {
      const job = jobs[`queue:${cur.id}`];
      if (job && (job.status === 'DONE' || job.status === 'FAILED')) {
        setQueue((q) => q.map((x) => (x.id === cur.id
          ? { ...x, status: job.status === 'DONE' ? 'done' : 'error', error: job.status === 'DONE' ? undefined : (job.message || job.error || undefined) }
          : x)));
        loadRef.current();
      }
      return;
    }
    if (cur.status === 'signing') return; // gate ochiq — imzo kutilyapti
    // cur.status === 'wait'
    //
    // SHU FIRMADA SERVERDA PARTIYA KETAYOTGAN BO'LSA — KUTAMIZ.
    //
    // prepare-ready bir firmaga ikkinchi partiyani rad etadi (409). Ilgari navbat buni
    // bilmasdi: darhol yuborar, 409 olardi va yozuv qizil «xato» bo'lib qolardi — operator
    // esa ishni qo'lda qaytadan qo'shishga majbur bo'lardi. Endi yozuv shunchaki navbatda
    // turadi va oldingi partiya tugashi bilan O'ZI boshlanadi (`activeBatchByFirm` har 5
    // soniyada yangilanadi, ya'ni bu effekt o'zi qayta ishga tushadi).
    if (activeBatchByFirm.has(cur.firmId)) return;
    if (signedFirms.current.has(cur.firmId)) {
      setQueue((q) => q.map((x) => (x.id === cur.id ? { ...x, status: 'sending' } : x)));
      startJob(`queue:${cur.id}`, { firmId: cur.firmId, snapshotId, limit: cur.count, ...(cur.courtIds?.length ? { courtIds: cur.courtIds } : {}), suitMode: true }, () => {});
    } else {
      setQueue((q) => q.map((x) => (x.id === cur.id ? { ...x, status: 'signing' } : x)));
      setQueueGate({ itemId: cur.id, firmId: cur.firmId, firmName: cur.firmName, stir: cur.stir, count: cur.count });
    }
  }, [jobs, queue, queueActive, snapshotId, startJob, activeBatchByFirm]);

  const firmOpts = [{ value: 'all', label: t('Hamma firma') }, ...firms.map((f) => ({ value: String(f.firmId), label: f.firmName, hint: n(f.total) }))];
  const ov = data?.readiness.overall;

  // 24/7 avto-qoralama holati (Go) — HeaderShell primary/running/notice va FirmQueue rows uchun.
  const draftAuto = useDraftAuto(active);
  const draftAutoData = draftAuto.data;
  // Firma → paused/lastBatch tez qidirish uchun.
  const draftAutoByFirm = React.useMemo(() => {
    const m = new Map<number, DraftFirmRow>();
    for (const f of draftAutoData?.firms ?? []) m.set(f.firmId, f);
    return m;
  }, [draftAutoData]);
  // Ayni damdagi partiya (worker bir vaqtda BITTA COURT_SUBMIT ishlaydi — yagona haqiqat manbasi).
  const activeBatch = draftAutoData?.active ?? null;
  const activeKind: DraftJobKind = activeBatch ? (activeBatch.kind ?? (activeBatch.draftMode ? 'suit' : 'real')) : 'suit';
  const activeKindLabel = KIND_LABEL[activeKind];
  // Oxirgi qoralama partiyasi yiqilgan firmalar — HeaderShell.notice va drilldown uchun.
  const failedFirms = (draftAutoData?.firms ?? []).filter((f) => f.lastBatch && isBatchFailed(f.lastBatch));
  const portalBackoffAt = draftAutoData?.backoff?.nextAttemptAt ?? null;
  // Tugallanmagan navbat aggregati — pendingQ dan (chip emas, notice matnida faqat sanaladi).
  const pendingFirmsCount = pendingQ.filter((q) => (q.pending + q.running) > 0 && !q.job).length;

  // «Ketmoqda» strip firma nomi: activeBatch.firmName bo'lmasa, jadvaldan topamiz.
  const activeFirmName = activeBatch?.firmName
    ?? (activeBatch?.firmId != null ? draftAutoByFirm.get(activeBatch.firmId)?.firmName : null)
    ?? (activeBatch?.firmId != null ? firms.find((f) => f.firmId === activeBatch.firmId)?.firmName : null)
    ?? '—';

  // Drilldown modal (Go xatosi/holati tafsiloti) — HeaderShell notice action → 'draftAuto'.
  const [drill, setDrill] = useState<null | 'draftAuto'>(null);

  // HeaderShell notice: ustunlik tartibi — portal bloki > firmada xato > tugallanmagan navbat.
  // Bitta strip, bitta matn: ilgari uchta panel bir xil sonlarni takrorlab kelardi (2026-09-20).
  const notice: null | { tone: 'warn'; text: string; action?: { label: string; onClick: () => void } } = (() => {
    if (portalBackoffAt) return {
      tone: 'warn' as const,
      text: `${t('Portal vaqtincha bloklagan (ketma-ket xatolar) — navbatni avtomat davom ettirish')} ${hhmm(portalBackoffAt)} ${t('dan keyin qayta uriniladi.')}`,
      ...(failedFirms.length > 0 ? { action: { label: t('Batafsil'), onClick: () => setDrill('draftAuto') } } : {}),
    };
    if (failedFirms.length > 0) return {
      tone: 'warn' as const,
      text: `${t('Oxirgi qoralama partiyasi')} ${n(failedFirms.length)} ${t('ta firmada xato bergan')}`,
      action: { label: t('Batafsil'), onClick: () => setDrill('draftAuto') },
    };
    if (pendingFirmsCount > 0) return {
      tone: 'warn' as const,
      text: `${n(pendingFirmsCount)} ${t('firmada tugallanmagan navbat — pastdagi firma qatoridan davom ettiring')}`,
    };
    return null;
  })();

  // Firma dropdown — HeaderShell.firmSlot ichida. Ilgari toolbar'da alohida turardi.
  const firmDropdown = (
    <Dropdown value={firmId ? String(firmId) : 'all'} options={firmOpts}
      onChange={(v) => { const next = v === 'all' ? null : Number(v); setFirmId(next); setOpenFirm(null); onFirmChange?.(next); }}
      className="w-full sm:w-auto sm:min-w-[200px]" />
  );

  return (
    <div className="card p-4">
      {loading ? (
        <div className="grid gap-2 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : !data ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-[12px] font-medium text-rose-500" role="alert">
          <span>{error ?? t('Yuklab boʻlmadi')}</span>
          <button onClick={() => load()} className="rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">{t('Qayta urinish')}</button>
        </div>
      ) : (
        <div className={refreshing ? 'opacity-60 transition-opacity duration-200' : 'transition-opacity duration-200'}>
          {error && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" role="alert">
              <span>{t('Yangilanmadi')} ({error}) — {t('eski maʼlumot koʻrsatilyapti.')}</span>
              <button onClick={() => load()} className="rounded border border-line px-1.5 py-0.5 hover:border-amber-500/50">{t('Qayta')}</button>
            </div>
          )}

          <div key="send" className="animate-fade-in space-y-3">
            {/* HEADER — bitta karta: sarlavha, firma, «Excel ▾», Go tugmasi, 5 stat, YAGONA
                «Ketmoqda» strip, notice. 2026-09-20: ilgari alohida toolbar + ring karta +
                5 Stat karta + AlmostLine + brauzer navbat + DraftAutoPanel + pendingQ — hammasi
                bir ekranda bir xil sonlarni takrorlab kelardi. */}
            <HeaderShell
              title="Qoralama"
              subtitle="Hujjati to‘liq mijozlardan ADOLAT «Murojaatlarim»da qoralama tayyorlanadi"
              firmSlot={firmDropdown}
              updatedAt={lastLoaded ? lastLoaded.toLocaleTimeString('ru-RU') : null}
              primary={draftAutoData
                ? (draftAutoData.on
                    ? { label: 'Avtomatni to‘xtatish', tone: 'rose', onClick: () => { void draftAuto.toggle(); }, disabled: draftAuto.busy, title: t('Yangi qoralama partiyalari boshlanmaydi (ketayotgani tugaydi)') }
                    : { label: 'Avtomatni yoqish (24/7)', tone: 'brand', onClick: () => { void draftAuto.toggle(); }, disabled: draftAuto.busy, title: t('Tayyor ishlar uchun ADOLAT «Murojaatlarim»da qoralama tayyorlash — 24/7, sudga yuborilmaydi') })
                : null}
              secondary={[{ label: 'Excel ▾', onClick: () => setXlsOpen((v) => !v) }]}
              stats={[
                { key: 'total', label: 'Jami', value: ov!.total, tone: 'slate' },
                { key: 'ready', label: 'Tayyor', value: ov!.sendable, tone: 'emerald', hint: 'Hujjati to‘liq, hali navbatga olinmagan' },
                { key: 'queued', label: 'Navbatda', value: ov!.queued, tone: 'amber', hint: 'Partiyaga olingan — qoralama tayyorlanmoqda' },
                { key: 'draft', label: 'Qoralama', value: ov!.draftReady, tone: 'teal', hint: 'ADOLAT «Murojaatlarim»da tayyor — «Sudga o‘tkazish» tabida yuboriladi' },
                { key: 'sent', label: 'Sudda', value: ov!.submitted + ov!.submittedExternal, tone: 'indigo', hint: 'ADOLAT’da ochilgan da’volar (tizim + yurist qo‘lda)' },
              ]}
              running={activeBatch
                ? { firmName: activeFirmName, kindLabel: activeKindLabel, progress: activeBatch.progress, total: activeBatch.total }
                : null}
              notice={notice}
            />

            {/* FIRMA NAVBATI — har qatorда bir chip (navbatda/tayyor), ixtiyoriy «ketmoqda»
                (aynan shu firma ishlayotgan bo'lsa) va bitta amal tugmasi. Boshqa hech
                narsa: done/skipped/failed son'lari drilldown modalida (Batafsil). */}
            {data.readiness.firms.length > 0 && (
              <FirmQueue
                title="Firmalar navbati"
                subtitle="Har firma — bir chip navbat holati, bir tugma amal"
                rows={data.readiness.firms.map<FirmQueueRow>((f) => {
                  const dfa = draftAutoByFirm.get(f.firmId);
                  const paused = dfa?.paused === true;
                  const isRunning = activeBatch?.firmId === f.firmId;
                  const chips: FirmQueueRow['chips'] = f.queued > 0
                    ? [{ label: `${n(f.queued)} navbatda`, tone: 'amber' as Tone, hint: 'Partiyaga olingan — qoralama tayyorlanmoqda' }]
                    : f.sendable > 0
                      ? [{ label: `${n(f.sendable)} tayyor`, tone: 'emerald' as Tone, hint: 'Hujjati to‘liq, hali navbatga olinmagan' }]
                      : [];
                  const action: FirmQueueRow['action'] = f.sendable > 0 && !paused
                    ? { label: `Qoralama tayyorlash (${n(f.sendable)})`, tone: 'brand' as Tone, onClick: () => startExport(f.firmId, {}), title: t("Soni so‘raladi — ADOLAT «Murojaatlarim»da qoralama (sudga yuborilmaydi)") }
                    : paused
                      ? { label: 'Davom ettirish', tone: 'emerald' as Tone, onClick: () => { void draftAuto.setFirmPaused(f.firmId, false); }, title: t('Bu firmani davom ettirish (qoralama va «Sudga o‘tkazish»)') }
                      : null;
                  return {
                    firmId: f.firmId,
                    firmName: f.firmName,
                    chips,
                    running: isRunning && activeBatch
                      ? { progress: activeBatch.progress, total: activeBatch.total, kindLabel: activeKindLabel }
                      : null,
                    action,
                    emptyText: f.sendable === 0 && !paused ? 'Tayyor mijoz yo‘q' : undefined,
                    paused,
                  };
                })}
              />
            )}

            {/* FirmSendRow ro'yxati — kengaytirilgan drilldown (ring, docs, ⋮ menyu, batafsil).
                2026-09-20 dan boshlab BOSH UI EMAS: asosiy oqim FirmQueue orqali, bu qatorlar
                esa batafsil ishlash uchun (ba'zi operatorlar ular orqali ishlaydi). */}
            <div className="space-y-2">
              {data.readiness.firms.length === 0
                ? <EmptyBlock title={t('Bu snapshotda mijoz yoʻq')} hint={t('Sidebar sanasini tekshiring yoki Hisobotda konveyerni yangilang.')} />
                : data.readiness.firms.map((fr, i) => (
                  <FirmSendRow
                    key={fr.firmId}
                    fr={fr}
                    idx={i}
                    snapshotId={snapshotId}
                    job={jobs[`firm:${fr.firmId}`]}
                    batchActive={activeBatchByFirm.get(fr.firmId) ?? null}
                    showQueued={(ov?.queued ?? 0) > 0}
                    zipJob={jobs[`zip:${fr.firmId}`]}
                    startExport={startExport}
                    onZip={() => setZipAsk({ firmId: fr.firmId, firmName: fr.firmName, max: fr.sendable, value: Math.min(MAX_ZIP_BATCH, fr.sendable) })}
                    onZipCancel={(jobId) => { void cancelJob(`zip:${fr.firmId}`, jobId); }}
                    onChanged={load}
                    drillOpen={openFirm === fr.firmId}
                    onToggleDrill={() => setOpenFirm((o) => (o === fr.firmId ? null : fr.firmId))}
                  />
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Excel eksportlari — Modal (avval sarlavhaga yopishgan popup edi; HeaderShell secondary
          tugmasi bir joyда, modal esa har qanday viewport'da to'g'ri turadi). */}
      {xlsOpen && (
        <Modal open onClose={() => setXlsOpen(false)} title={t('Excel eksportlari')} size="md">
          <div className="divide-y divide-line rounded-lg border border-line overflow-hidden">
            {[
              { href: `/konveyer/court-stats-excel${selectedId ? `?s=${selectedId}` : ''}`, title: t('Firma statistikasi'), hint: t('Har firma: jami · tayyor · sudda · yetishmayotgan hujjatlar') },
              { href: `/konveyer/cases-excel${selectedId ? `?s=${selectedId}` : ''}${firmId ? `${selectedId ? '&' : '?'}firmId=${firmId}` : ''}`, title: t('Mijozlar ro‘yxati'), hint: t('F.I.O · PINFL · firma · qarzdorlik · boji · muddat') },
              { href: `/konveyer/court-returns-excel${selectedId ? `?s=${selectedId}` : ''}${firmId ? `${selectedId ? '&' : '?'}firmId=${firmId}` : ''}`, title: t('Suddan qaytganlar'), hint: t('Qayta yuborish uchun ishlash ro‘yxati') },
              { href: `/konveyer/unpaid-receipts-excel${firmId ? `?firmId=${firmId}` : ''}`, title: t('To‘lanmagan kvitansiyalar'), hint: t('Buxgalteriya uchun: to‘lov kutayotgan ishlar · raqam · summa') },
            ].map((x) => (
              <a key={x.href} href={x.href} onClick={() => setXlsOpen(false)}
                className="block px-3 py-2 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2">
                <span className="block text-[12px] font-medium">{x.title}</span>
                <span className="block text-[11px] leading-snug text-muted">{x.hint}</span>
              </a>
            ))}
          </div>
        </Modal>
      )}

      {/* MONITORING (batafsil) — HeaderShell.notice «Batafsil» tugmasidan. Firmalar bo'yicha
          oxirgi partiya natijasi, pauza, tugallanmagan navbat — hammasi shu modalда. */}
      {drill === 'draftAuto' && draftAutoData && (
        <Modal open onClose={() => setDrill(null)} title={t('Avtomat monitoring — firmalar kesimi')} size="lg">
          <div className="space-y-1.5 text-[12px]">
            {draftAutoData.firms.map((f) => {
              const lb = f.lastBatch;
              const failed = lb && isBatchFailed(lb);
              const isRun = activeBatch?.firmId === f.firmId;
              const pq = pendingQ.find((p) => p.firmId === f.firmId);
              const waiting = pq ? pq.pending + pq.running : 0;
              return (
                <div key={f.firmId} className={`rounded-lg border p-2 ${failed ? 'border-rose-500/40 bg-rose-500/[0.04]' : f.paused ? 'border-rose-500/30 bg-rose-500/[0.03] opacity-80' : isRun ? 'border-sky-500/40 bg-sky-500/[0.05]' : 'border-line'}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 truncate font-medium">{f.firmName}</span>
                    <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-300" title={t('Tayyor')}>{n(f.sendable)} {t('tayyor')}</span>
                    <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-amber-700 dark:text-amber-300" title={t('Navbatda')}>{n(f.queued)} {t('navbatda')}</span>
                    <span className="shrink-0 rounded bg-teal-500/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-teal-700 dark:text-teal-300" title={t('Qoralama tayyor')}>{n(f.draftReady)} {t('qoralama')}</span>
                    {pq && pq.failed > 0 && (
                      <span className="shrink-0 rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-rose-700 dark:text-rose-300">{n(pq.failed)} {t('xato')}</span>
                    )}
                    {pq && pq.skipped > 0 && (
                      <span className="shrink-0 rounded bg-slate-500/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-600 dark:text-slate-300" title={t(SKIP_HINT)}>{n(pq.skipped)} {t('o‘tkazildi')}</span>
                    )}
                    {f.paused
                      ? <button type="button" onClick={() => { void draftAuto.setFirmPaused(f.firmId, false); }} className="shrink-0 rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300">{t('Davom ettirish')}</button>
                      : <button type="button" onClick={() => { void draftAuto.setFirmPaused(f.firmId, true); }} className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] font-medium text-muted hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-300" title={t('Bu firmani to‘xtatish — qoralama HAM, «Sudga o‘tkazish» HAM to‘xtaydi (boshqa firmalar ketaveradi)')}>{t('Firmani to‘xtatish')}</button>}
                    {pq && waiting > 0 && !pq.job && (
                      <button type="button"
                        onClick={() => { setDrill(null); setGate({ firmId: f.firmId, firmName: f.firmName, stir: pq.stir, extra: { resume: true }, summary: `${f.firmName} — ${t('navbatda qolgan')} ${n(pq.pending)} ${t('ta ishni davom ettirish (o‘z rejimida: qoralama sudga yuborilmaydi)')}` }); }}
                        className="shrink-0 rounded bg-brand-500 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-brand-600">{t('Navbatni davom ettirish')}</button>
                    )}
                  </div>
                  {lb && (
                    <div className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] ${failed ? 'text-rose-700 dark:text-rose-300' : 'text-muted'}`}>
                      <span className="tabular-nums">#{lb.jobId} · {hhmm(lb.finishedAt)}</span>
                      <span>· {failed ? t('oxirgi partiya: xato') : lb.status === 'CANCELED' ? t('oxirgi partiya: to‘xtatilgan') : t('oxirgi partiya: tayyor')}</span>
                      {lb.message && <span className="min-w-0 flex-1 truncate" title={lb.message}>· {lb.message}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* ZIP eksport — hujjatlarni bitta arxivga yig'ib yuklab olish.
          Sudga YUBORMAYDI: portalga bitta ham so'rov ketmaydi, shuning uchun E-IMZO,
          pauza va sud kunlik limiti bu yerda qo'llanmaydi. */}
      {zipAsk && (
        <Modal
          open
          onClose={() => setZipAsk(null)}
          title={`${t('ZIP yuklab olish —')} ${zipAsk.firmName}`}
          // TANLOV QOIDASI AYTILADI. Ilgari modalda faqat son turardi va operator 100 talik
          // ikkita arxivni olib, ichida kim borligini ham, ular ustma-ust tushadimi-yo'qmi
          // ham bilolmasdi — ZIP'ni ochib papka nomlarini o'qishga majbur edi (2026-09-08).
          // Server tanlovi `selectReadyCaseIds`: dueAt bo'yicha o'sish tartibida, ya'ni
          // ENG ESKI MUDDATLILARDAN boshlab N ta.
          description={`${n(zipAsk.max)} ${t("ta tayyor mijoz — standart: HAMMASI. Eng eski muddatlilardan boshlab tanlanadi. Hujjatlar bitta arxivga yig'iladi, sudga yuborilmaydi.")}`}
          footer={<>
            <button className="btn-ghost" type="button" onClick={() => setZipAsk(null)}>{t('Bekor')}</button>
            <button
              className="btn-primary" type="button"
              disabled={!zipAsk.value || zipAsk.value < 1}
              onClick={() => {
                const v = Math.max(1, Math.min(zipAsk.max, Math.floor(zipAsk.value) || 0));
                const fid = zipAsk.firmId;
                setZipAsk(null);
                // E-IMZO gate'siz: ZIP portalga bitta ham so'rov yubormaydi, shuning uchun
                // kalit bilan tasdiqlash mantiqsiz edi.
                runZip(fid, v);
              }}
            >
              {(() => {
                const v = Math.max(1, Math.min(zipAsk.max, Math.floor(zipAsk.value) || 0));
                const all = Math.min(MAX_ZIP_BATCH, zipAsk.max);
                return v >= all ? `${t('ZIP tayyorlash — hammasi')} (${n(v)})` : `${t('ZIP tayyorlash')} (${n(v)})`;
              })()}
            </button>
          </>}
        >
          <div className="space-y-3">
            {/* Standart — HAMMASI. «Hammasi» chip'i birinchi va tanlangan holda turadi:
                operator hech nimaga tegmasdan «ZIP tayyorlash» bossa, hammasi ketadi.
                Kichik raqamlar (50/100/250…) faqat ataylab kamaytirish uchun. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(() => {
                const all = Math.min(MAX_ZIP_BATCH, zipAsk.max);
                const isAll = zipAsk.value >= all;
                return (
                  <button type="button" onClick={() => setZipAsk((c) => c && ({ ...c, value: all }))} aria-pressed={isAll}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${isAll ? 'bg-brand-500 text-white shadow-sm' : 'border border-line text-fg hover:bg-surface-2'}`}>
                    {t('Hammasi')} ({n(all)})
                  </button>
                );
              })()}
              {[50, 100, 250, 500].filter((x) => x < Math.min(MAX_ZIP_BATCH, zipAsk.max)).map((x) => (
                <button key={x} type="button" onClick={() => setZipAsk((c) => c && ({ ...c, value: x }))} aria-pressed={zipAsk.value === x}
                  className={`rounded-lg px-2 py-1.5 text-[11px] font-medium tabular-nums transition-colors ${zipAsk.value === x ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2'}`}>
                  {n(x)}
                </button>
              ))}
            </div>
            <label className="field-label">{t('Yoki aniq soni')}
              <input
                type="number" min={1} max={Math.min(MAX_ZIP_BATCH, zipAsk.max)}
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm tabular-nums outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                value={zipAsk.value}
                onChange={(e) => setZipAsk((c) => c && ({ ...c, value: Math.max(1, Math.min(Math.min(MAX_ZIP_BATCH, c.max), Number(e.target.value) || 0)) }))}
              />
            </label>
            {/* «Qolganini keyingi ZIP bilan olasiz» deb yozib bo'lmaydi: ZIP olingani
                tanlovga TA'SIR QILMAYDI (2026-09-07 da «allaqachon chiqarilgan» filtri
                ataylab olib tashlangan — selectReadyCaseIds). Ya'ni ketma-ket ikkita ZIP
                bir xil, eng eski muddatli mijozlarni beradi. Buni aytmaslik operatorni
                ikkita arxiv butunlay boshqa mijozlar deb o'ylashga majbur qilardi.

                DIQQAT: bu yerda operatorni «Batafsil»ga yuborish MUMKIN EMAS. Drill-down'da
                qo'lda belgilangan mijozlar uchun yagona ommaviy amal — «Sudga yuborish»
                (startExport → `caseIds`, `exportOnly` YO'Q), ya'ni u ZIP emas, REAL DA'VO
                yuboradi. Yuklab olish yo'li deb ko'rsatilgan matn operatorni tirik odamlarga
                da'vo ochadigan tugmaga olib borardi (2026-09-08 kod tekshiruvi). */}
            {zipAsk.max > MAX_ZIP_BATCH && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {t('Bir martada eng ko‘pi')} {n(MAX_ZIP_BATCH)} {t('ta — eng eski muddatlilari olinadi.')}
                {t('Qolgan')} {n(zipAsk.max - MAX_ZIP_BATCH)} {t("tasi keyingi ZIP'ga O‘ZI o‘tmaydi:")}
                {t('ikkinchi ZIP ham xuddi shu')} {n(MAX_ZIP_BATCH)} {t('tasini beradi.')}
              </p>
            )}
            <div className="rounded-lg border border-line p-2.5 text-[11px] leading-snug text-muted">
              <span className="font-medium text-fg">{t('Filtr: «Tayyor»')}</span> {t("— 5 shart to'liq bajarilgan mijozlar (talabnoma + imzolangan skan + oferta + kvitansiya + boji). Arxivda har mijoz uchun alohida papka bo'ladi. Sudga yuborilganlar ro'yxatga KIRMAYDI — faqat hali yuborilmagan tayyorlari.")}
            </div>
          </div>
        </Modal>
      )}

      {countAsk && (() => { const askBusy = activeBatchByFirm.get(countAsk.firmId) ?? null; return (
        <Modal open onClose={() => { setCountAsk(null); setPickedCourts(null); }} title={`${t('Qoralama tayyorlash')} — ${countAsk.firmName}`}
          // «max» — NAVBATDAGILARSIZ tayyorlar soni. Navbatda turganini ham aytamiz, aks holda
          // operator «291 tayyor edi, nega 91 ta?» deb o'ylaydi (2026-09-07).
          description={`${n(countAsk.max)} ${t('ta tayyor')}${countAsk.queued ? ` (${t('yana')} ${n(countAsk.queued)} ${t('tasi navbatda — ular qayta olinmaydi')})` : ''}. ${t("Bir martada eng ko'pi")} ${MAX_COURT_BATCH} ${t('ta.')}`}
          footer={<>
            <button className="btn-ghost" type="button" onClick={() => setCountAsk(null)}>{t('Bekor')}</button>
            {/* Firmada partiya ketayotgan bo'lsa TO'G'RIDAN yuborish mumkin emas (server 409
                qaytaradi) — bunda yagona to'g'ri amal navbatga qo'shish, shuning uchun u
                asosiy tugmaga aylanadi va «Yuborish» yashiriladi. Aks holda operator
                bosadigan tugma bosilishi bilan xato bo'lardi. */}
            <button className={askBusy ? 'btn-primary' : 'btn-ghost'} type="button"
              disabled={countAsk.max < 1 || !countAsk.value || countAsk.value < 1 || (pickedCourts !== null && pickedCourts.length === 0)}
              title={askBusy
                ? `#${askBusy.jobId} ${t("tugashi bilan bu partiya o'zi boshlanadi — kalit qayta so'ralmaydi")}`
                : t("Navbatga qo'shish — bir nechta firma partiyasini ketma-ket tayyorlash (skayner kabi)")}
              onClick={() => { const v = Math.max(1, Math.min(countAsk.max, Math.floor(countAsk.value) || 0)); const f = firms.find((x) => x.firmId === countAsk.firmId); addToQueue(countAsk.firmId, countAsk.firmName, f?.stir ?? null, v, pickedCourts ?? undefined); setCountAsk(null); setPickedCourts(null); }}>
              + {t('Navbatga')}{askBusy ? ` (${Math.max(1, Math.min(countAsk.max, Math.floor(countAsk.value) || 0))})` : ''}
            </button>
            {!askBusy && (
              <button className="btn-primary" type="button"
                disabled={countAsk.max < 1 || !countAsk.value || countAsk.value < 1 || (pickedCourts !== null && pickedCourts.length === 0)}
                onClick={() => { const v = Math.max(1, Math.min(countAsk.max, Math.floor(countAsk.value) || 0)); const fid = countAsk.firmId; const cs = pickedCourts; setCountAsk(null); setPickedCourts(null); openGate(fid, { limit: v, ...(cs && cs.length ? { courtIds: cs } : {}), suitMode: true }); }}>
                {t('Qoralama tayyorlash')} ({Math.max(1, Math.min(countAsk.max, Math.floor(countAsk.value) || 0))})
              </button>
            )}
          </>}
        >
          <div className="space-y-3">
            <label className="block">
              <span className="field-label">{t('Soni')} (1–{Math.min(MAX_COURT_BATCH, countAsk.max)})</span>
              <input type="number" min={1} max={Math.min(MAX_COURT_BATCH, countAsk.max)} value={countAsk.value}
                onChange={(e) => { const raw = Math.floor(Number(e.target.value) || 0); setCountAsk((c) => c && ({ ...c, value: Math.max(0, Math.min(c.max, raw)) })); }}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm tabular-nums outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30" autoFocus />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[10, 25, 50, 100, MAX_COURT_BATCH].filter((q, i, a) => q <= countAsk.max && a.indexOf(q) === i).map((q) => (
                <button key={q} type="button" onClick={() => setCountAsk((c) => c && ({ ...c, value: q }))}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${countAsk.value === q ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:border-brand-500/40'}`}>{q}</button>
              ))}
              {countAsk.max < MAX_COURT_BATCH && (
                <button type="button" onClick={() => setCountAsk((c) => c && ({ ...c, value: c.max }))}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${countAsk.value === countAsk.max ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:border-brand-500/40'}`}>{t('Hammasi')} ({countAsk.max})</button>
              )}
            </div>
            {/* 2026-09-19: «Qoralama» belgisi va «Auto» belgisi OLIB TASHLANDI. Ilgari bitta checkbox
                qoralamani QAYTARIB BO'LMAYDIGAN real yuborishga aylantirardi (boji to'langanlar,
                send-to-court) — endi bu modal FAQAT qoralama qiladi; real yuborish — «Sudga o'tkazish»
                tabida, saqlangan suit'ni E-IMZO bilan. Uzluksiz tayyorlash — yuqoridagi «Go — 24/7». */}
            <div className="rounded-lg border border-teal-500/40 bg-teal-500/[0.05] p-2.5 text-[11px] leading-snug">
              <span className="block text-[12px] font-medium text-teal-700 dark:text-teal-300">{t('ADOLAT «Murojaatlarim»da qoralama tayyorlanadi — sudga YUBORILMAYDI')}</span>
              <span className="mt-0.5 block text-muted">
                {t('Har ish uchun ADOLAT’da da’vo to‘liq to‘ldirilib, hujjatlar biriktirilib saqlanadi. Sudga yuborish keyin «Sudga o‘tkazish» tabidan, firma kaliti (E-IMZO) bilan. Sud kunlik limitini band qilmaydi. Uzluksiz tayyorlash uchun — yuqoridagi «Go — 24/7».')}
              </span>
            </div>
            {courtBreak && courtBreak.firmId === countAsk.firmId && courtBreak.courts.length > 0 && (
              <div className="rounded-lg border border-line p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-muted">{t('Qaysi sud ishlari tayyorlansin? (tayyor')} {n(courtBreak.total)} {t('ta)')}</span>
                  {pickedCourts !== null && (
                    <button onClick={() => setPickedCourts(null)} className="text-[11px] font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">{t('hammasi')}</button>
                  )}
                </div>
                <div className="space-y-1">
                  {courtBreak.courts.map((c) => {
                    // Tanlab bo'lmaydigan ikki holat:
                    //  • courtId=null — «Sud tayinlanmagan»: bunday ishlar firmaning asosiy
                    //    sudiga yo'naltiriladi (court-routing.ts);
                    //  • enabled=false — sud ADOLAT orqali elektron ariza qabul qilmaydi.
                    //    Bunday sud RO'YXATDAN OLIB TASHLANMAYDI, aksincha sababi bilan
                    //    ko'rsatiladi — aks holda operator ishlari nega ketmayotganini bilmaydi.
                    const closed = c.enabled === false;
                    const selectable = c.courtId != null && !closed;
                    const on = !closed && (pickedCourts === null || (c.courtId != null && pickedCourts.includes(c.courtId)));
                    return (
                      <label
                        key={c.courtId ?? 'none'}
                        className={`flex items-start justify-between gap-2 rounded px-1.5 py-1 text-xs ${selectable ? 'cursor-pointer hover:bg-surface-2' : 'opacity-70'}`}
                        title={closed ? (c.note ?? t('Bu sud ADOLAT orqali elektron ariza qabul qilmaydi'))
                          : selectable ? undefined : t('Bu ishlarga sud hali biriktirilmagan — firmaning asosiy sudiga ketadi')}
                      >
                        <span className="flex min-w-0 items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-3.5 w-3.5 accent-brand-500"
                            checked={on}
                            disabled={!selectable}
                            onChange={(e) => {
                              if (c.courtId == null) return;
                              const all = courtBreak.courts
                                .filter((x) => x.courtId != null && x.enabled !== false)
                                .map((x) => x.courtId as number);
                              const cur = pickedCourts === null ? all : pickedCourts;
                              const next = e.target.checked ? [...new Set([...cur, c.courtId])] : cur.filter((x) => x !== c.courtId);
                              // Hammasi tanlansa — null (cheklovsiz) holatiga qaytamiz.
                              setPickedCourts(next.length === all.length ? null : next);
                            }}
                          />
                          <span className="min-w-0">
                            <span className={`block truncate ${closed ? 'text-muted line-through' : ''}`}>{c.shortName}</span>
                            {closed && (
                              <span className="mt-0.5 block text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                                {c.note ?? t('ADOLAT’da elektron qabul yoqilmagan — sud administratori hal qiladi')}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className={`shrink-0 tabular-nums font-medium ${closed ? 'text-muted' : ''}`}>{n(c.count)}</span>
                      </label>
                    );
                  })}
                </div>
                {pickedCourts !== null && pickedCourts.length === 0 && (
                  <p className="mt-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">{t('Hech bo‘lmasa bitta sud tanlanishi kerak.')}</p>
                )}
                <p className="mt-1.5 text-[10px] leading-snug text-muted">{t('Boshqa sudga allaqachon biriktirilgan ishlar tanlangan sudga ko‘chirilmaydi — ular keyingi safarga qoladi.')}</p>
              </div>
            )}
            <p className="text-[11px] text-muted">{t('Eng eski (muddati yaqin) tayyor mijozlardan boshlab olinadi.')}</p>
          </div>
        </Modal>
      ); })()}

      {gate && (
        <KeyPicker
          open
          onClose={() => setGate(null)}
          firm={{ firmId: gate.firmId, firmName: gate.firmName, stir: gate.stir }}
          provider="CABINET"
          endpoint="/konveyer/court-sign"
          // Qoralama uchun ham kalit so'raladi — u firma ADOLAT sessiyasini yangilaydi. Sarlavha va
          // tugma endi «yuborish» demaydi (ilgari qoralamada ham «Imzolab yuborish» turardi).
          title={(gate.extra as { resume?: boolean }).resume ? t('Navbatni davom ettirish — kalit bilan tasdiqlash') : t('Qoralama tayyorlash — kalit bilan tasdiqlash')}
          confirmLabel={(gate.extra as { resume?: boolean }).resume ? t('Imzolab davom etish') : t('Imzolab tayyorlash')}
          summary={gate.summary}
          onSuccess={() => {
            const ex = gate.extra as { resume?: boolean };
            if (ex.resume) { runResume(gate.firmId); setGate(null); return; }
            runExport(gate.firmId, gate.extra);
            setGate(null);
          }}
        />
      )}

      {queueGate && (
        <KeyPicker
          open
          onClose={() => { const id = queueGate.itemId; setQueueGate(null); setQueueActive(false); setQueue((q) => q.map((x) => (x.id === id ? { ...x, status: 'error' } : x))); }}
          firm={{ firmId: queueGate.firmId, firmName: queueGate.firmName, stir: queueGate.stir }}
          provider="CABINET"
          endpoint="/konveyer/court-sign"
          title={t('Qoralama navbati — kalit bilan tasdiqlash')}
          confirmLabel={t('Imzolab davom etish')}
          summary={`${queueGate.firmName}: ${queueGate.count} ${t('ta ish uchun ADOLAT’da qoralama tayyorlanadi — sudga YUBORILMAYDI. Firma kaliti bilan tasdiqlang (bu firma uchun bir marta).')}`}
          onSuccess={() => { const g = queueGate; signedFirms.current.add(g.firmId); setQueue((q) => q.map((x) => (x.id === g.itemId ? { ...x, status: 'wait' } : x))); setQueueGate(null); }}
        />
      )}
    </div>
  );
}
