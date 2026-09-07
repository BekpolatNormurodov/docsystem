'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, useConfirm } from '@/ui';
import { Dropdown } from './Dropdown';
import { CaseDocs } from './CaseDocs';
import { KeyPicker } from './KeyPicker';
// Partiya hajmi — yagona manba (server ham shu qiymat bilan cheklaydi).
import { MAX_COURT_BATCH } from '@/lib/court-batch';

// ── types (mirror src/lib/court-ready.ts) ────────────────────────────────────
interface Missing { talabnoma: number; scan: number; oferta: number; receipt: number; boji: number }
interface FirmDocsStatus { complete: boolean; missing: string[]; present: string[] }
interface FirmReadiness { firmId: number; firmName: string; total: number; ready: number; exported: number; submitted: number; draft: number; sendable: number; missing: Missing; almost: Missing; docs: FirmDocsStatus }
// Sud paketiga qo'shiladigan firma hujjatlari — 3 tasi ham kerak.
const FIRM_DOCS_ALL = ['guvohnoma', 'ishonchnoma', 'shartnoma'];
interface Overall { total: number; ready: number; exported: number; submitted: number; draft: number; sendable: number; missing: Missing; almost: Missing }
interface StatusBucket { code: string; label: string; tone: string; count: number; source: string }
interface StatusBoard { total: number; matched: number; buckets: StatusBucket[]; sources: Record<string, number> }
interface ReturnCase {
  caseId: number; clientName: string | null; pinfl: string | null; firmId: number; firmName: string;
  stage: string; stageLabel: string; receiptNumber: string | null; talabnomaSent: boolean;
  totalDebt: string; daysLeft: number | null; docCount: number;
}
interface Data { snapshotId?: number; readiness: { firms: FirmReadiness[]; overall: Overall }; statusBoard: StatusBoard; returns: ReturnCase[] }

type ReadyFilter = 'all' | 'sendable' | 'draft' | 'ready' | 'exported' | 'submitted' | 'notready';
interface ClientRow {
  caseId: number; clientName: string | null; pinfl: string | null; stage: string; stageLabel: string;
  talabnoma: boolean; talabnomaDelivered: boolean; receipt: boolean; scan: boolean; oferta: boolean; boji: boolean;
  ready: boolean; exported: boolean; submitted: boolean; draft: boolean; sendable: boolean; totalDebt: string; daysLeft: number | null;
  receiptNumber: string | null;
  // Sud — «Batafsil» ichidagi filtr uchun (firma ishlari bir necha sudga bo'lingan bo'lishi mumkin).
  courtId: number | null; courtName: string | null; courtEnabled: boolean;
}
interface ClientCounts { all: number; sendable: number; draft: number; ready: number; exported: number; submitted: number; notready: number }
interface ClientPage { rows: ClientRow[]; total: number; page: number; pageSize: number; pages: number; counts: ClientCounts; error?: string }

type JobState = { jobId: number; status: string; progress: number; total: number; error?: string; message?: string; type?: string };

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
async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (res.redirected || res.url.includes('/login')) {
      throw new Error('Sessiya tugagan — sahifani yangilab, qaytadan kiring.');
    }
    throw new Error(`Server JSON qaytarmadi (${res.status}). Sahifani yangilab ko‘ring.`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error((data as any)?.error || `Server xatosi (${res.status})`);
  return data as T;
}

// Literal class strings only (Tailwind JIT can't see interpolated names).
const TONE: Record<string, string> = {
  slate: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
  sky: 'bg-sky-500/12 text-sky-600 dark:text-sky-300',
  blue: 'bg-blue-500/12 text-blue-600 dark:text-blue-300',
  violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-300',
  amber: 'bg-amber-500/12 text-amber-600 dark:text-amber-300',
  emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300',
  rose: 'bg-rose-500/12 text-rose-600 dark:text-rose-300',
  teal: 'bg-teal-500/12 text-teal-600 dark:text-teal-300',
};
const BAR: Record<string, string> = {
  slate: '#64748b', sky: '#0ea5e9', blue: '#3b82f6', violet: '#8b5cf6',
  amber: '#f59e0b', emerald: '#10b981', rose: '#f43f5e', teal: '#14b8a6',
};
const VALUE_TONE: Record<string, string> = {
  slate: '', emerald: 'text-emerald-600 dark:text-emerald-400',
  sky: 'text-sky-600 dark:text-sky-400', amber: 'text-amber-600 dark:text-amber-400',
  violet: 'text-violet-600 dark:text-violet-400',
  // «Sudda» — sudga rasman topshirilgan da'volar. Tailwind JIT interpolatsiya qilingan
  // sinf nomlarini ko'rmaydi, shuning uchun bu yerda to'liq yozilishi shart.
  indigo: 'text-indigo-600 dark:text-indigo-400',
};

// ── shared little bits ───────────────────────────────────────────────────────
const RING_STROKE: Record<'high' | 'mid' | 'low', string> = { high: '#10b981', mid: '#f59e0b', low: '#f43f5e' };
const ringTone = (pct: number) => (pct >= 80 ? 'high' : pct >= 40 ? 'mid' : 'low');

// Signature visual: readiness as a stroke-animated inline-SVG ring. The app's global
// prefers-reduced-motion rule zeroes the transition for free.
function ReadinessRing({ pct, size = 48, sw = 5 }: { pct: number; size?: number; sw?: number }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const big = size >= 88;
  return (
    <span role="img" aria-label={`${p}% tayyor`} className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
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

function Stat({ label, value, tone = 'slate', hint, icon }: { label: string; value: number; tone?: string; hint?: string; icon?: React.JSX.Element }) {
  return (
    <div className="flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface p-3 text-center" title={hint}>
      {icon}
      <div className={`text-3xl font-bold leading-none tabular-nums ${VALUE_TONE[tone] ?? ''}`}>{n(value)}</div>
      <div className="text-[11px] font-medium text-muted">{label}</div>
    </div>
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
  const cls = ok
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : optional ? 'border border-dashed border-line bg-transparent text-muted/40' : 'bg-surface-2 text-muted/60';
  const tip = optional ? `${label}: ${ok ? 'bor' : "yo'q"} — ma'lumot uchun (sud uchun shart emas)` : `${label}: ${ok ? 'bor' : "yo'q"}`;
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
  if (d === null) return null;
  if (d < 0) return <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-300">{Math.abs(d)} kun kechikdi</span>;
  if (d === 0) return <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">bugun</span>;
  return <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">{d} kun</span>;
}

const AVATAR = [
  'bg-sky-500/15 text-sky-600 dark:text-sky-300', 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  'bg-rose-500/15 text-rose-600 dark:text-rose-300', 'bg-teal-500/15 text-teal-600 dark:text-teal-300',
];
const avatarColor = (seed: string) => AVATAR[[...(seed || '0')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR.length];
const initials = (name: string | null) => (name || '—').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—';

// «1 qadam qolgan» — gate'ning 5 shartidan AYNAN bittasi yetishmagan case'lar (talabnoma/skan/
// oferta/check/boji), qaysi biri yetmasligiga qarab ajratilgan. Operatorga kim bitta hujjatdan
// sudga chiqishini ko'rsatadi. Beshovi ham majburiy gate — hammasi bu yerda paydo bo'lishi mumkin.
const ALMOST_DOCS: { key: keyof Missing; label: string; tone: string }[] = [
  { key: 'scan', label: 'skan', tone: 'bg-sky-500/12 text-sky-700 dark:text-sky-300' },
  { key: 'receipt', label: 'check', tone: 'bg-teal-500/12 text-teal-700 dark:text-teal-300' },
  { key: 'boji', label: 'invoice raqami', tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  { key: 'oferta', label: 'oferta', tone: 'bg-violet-500/12 text-violet-700 dark:text-violet-300' },
  { key: 'talabnoma', label: 'talabnoma', tone: 'bg-rose-500/12 text-rose-700 dark:text-rose-300' },
];
function AlmostLine({ almost, compact }: { almost: Missing; compact?: boolean }) {
  const items = ALMOST_DOCS.filter((a) => almost[a.key] > 0);
  const total = items.reduce((s, a) => s + almost[a.key], 0);
  if (total === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></svg>
        {n(total)} ta — 1 qadam qoldi:
      </span>
      {items.map((a) => (
        <span key={a.key} className={`rounded px-1.5 py-0.5 font-medium tabular-nums ${a.tone}`}>faqat {a.label} {n(almost[a.key])}</span>
      ))}
    </div>
  );
}

const IcoRefresh = ({ spin }: { spin?: boolean }) => (
  <svg className={`h-4 w-4 ${spin ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
);
const IcoBolt = () => <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /></svg>;
const IcoDown = () => <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /></svg>;

// The «Chiqarish» control, driven by the PARENT-owned job (survives firm-filter/tab switches).
function ExportControl({ job, sendable, onStart }: { job?: JobState; sendable: number; onStart: () => void }) {
  const running = !!job && (job.status === 'PENDING' || job.status === 'RUNNING');
  const done = job?.status === 'DONE';
  // (progress foizi ExportControl da endi kerak emas — raqamlar qator ostidagi yagona chiziqda)
  // Sudga yuborish (COURT_SUBMIT) job'i fayl YARATMAYDI — unga ZIP havolasi ko'rsatilsa 404
  // beradi. Uning o'rniga runner yozgan halol hisobot ko'rsatiladi
  // («N ta yuborildi, M ta XATO, K ta navbatda qoldi»).
  const isSubmit = job?.type === 'COURT_SUBMIT';
  if (done && job && isSubmit) {
    const hadError = /XATO/i.test(job.message || '');
    return (
      <div className="flex flex-col items-end gap-1">
        <span className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${hadError ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}>
          {job.message || `${job.total} ta yuborildi`}
        </span>
        {sendable > 0 && (
          <button onClick={onStart} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30" title={`Keyingi ${Math.min(MAX_COURT_BATCH, sendable)} ta`}>
            <IcoBolt /> Yana ({Math.min(MAX_COURT_BATCH, sendable)})
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
          <IcoDown /> {job.total} ta ZIP — yuklab olish
        </a>
        {sendable > 0 && (
          <button onClick={onStart} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30" title={`Keyingi ${Math.min(MAX_COURT_BATCH, sendable)} ta`}>
            <IcoBolt /> Yana ({Math.min(MAX_COURT_BATCH, sendable)})
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={onStart}
        disabled={running || sendable === 0}
        aria-busy={running}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-all hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-40"
        title={sendable === 0 ? 'Sudga yuborishga tayyor mijoz yoʻq' : `${Math.min(MAX_COURT_BATCH, sendable)} ta to'liq tayyor paketni sudga yuborish`}
      >
        {running
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Yuborilmoqda</>
          : <><IcoBolt /> Sudga yuborish {sendable > 0 ? `(${Math.min(MAX_COURT_BATCH, sendable)})` : ''}</>}
      </button>
      {/* Xato: worker yozgan sabab `message`da keladi (route xatosi esa `error`da). */}
      {/* Xato: FAILED holatida server sababi (`message`), yoki holat o'qilmay qolganda
          (masalan sessiya tugadi) poller yozgan `error` — u RUNNING paytida ham chiqishi
          kerak, aks holda progress jimgina qotib qolgandek ko'rinadi. */}
      {(job?.status === 'FAILED' || job?.error) && (
        <span className="text-[11px] font-medium text-rose-500" role="alert">
          {job?.status === 'FAILED' ? (job.message || job.error || 'Xatolik') : job?.error}
        </span>
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
  { key: 'draft', label: 'Qoralama', icon: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>), activeCls: 'bg-violet-500/15 text-violet-600 dark:text-violet-300', iconCls: 'text-violet-500' },
  { key: 'submitted', label: 'Sudda', icon: svg(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></>), activeCls: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300', iconCls: 'text-indigo-500' },
  { key: 'all', label: 'Hammasi', icon: svg(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>), activeCls: 'bg-slate-500/15 text-slate-700 dark:text-slate-300', iconCls: 'text-slate-500' },
];
// Firma qatoridagi qisqa xulosa — tab'lar bilan bir xil ikon/rang (Tayyor emas · Tayyor · Qoralama · Yuborilgan),
// «batafsil» yopiq paytda ko'rinadi. `all` chiqmaydi (u umumiy jami).
const firmStatValue = (fr: FirmReadiness, key: ReadyFilter): number =>
  key === 'notready' ? fr.total - fr.ready : key === 'sendable' ? fr.sendable : key === 'draft' ? fr.draft
    : key === 'submitted' ? fr.submitted : fr.total;
const filterMeta = (key: ReadyFilter) => CLIENT_FILTERS.find((f) => f.key === key)!;
// Rangli ikon (summary kartalari uchun) — tab'lar bilan bir xil.
const statIcon = (key: ReadyFilter) => { const m = filterMeta(key); return <span className={m.iconCls}>{m.icon}</span>; };

function statusChip(r: ClientRow) {
  // «Sudda» va «Chiqarilgan» — ATAYIN ikki xil holat.
  // 2026-09-07: BRIGHT qatorida «Yuborilgan 100» ko'rinardi, lekin ularning bittasi ham
  // sudga ketmagan edi — 100 tasida faqat ZIP paketi chiqarilgan. Operator ularni sudda
  // deb o'ylashi mumkin edi, shuning uchun endi belgi aniq: sudda bo'lgani — «Sudda».
  if ((r as { submitted?: boolean }).submitted) {
    return <span className="rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300" title="Da'vo ADOLAT orqali sudga topshirilgan">Sudda</span>;
  }
  if (r.draft) return <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">Qoralama</span>;
  if (r.sendable) return <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Tayyor</span>;
  return <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-300">Tayyor emas</span>;
}

const ClientRowCard = React.memo(function ClientRowCard({ r, firmId, selectable, checked, onCheck, onChanged, onUndo, undoing }: {
  r: ClientRow; firmId: number; selectable: boolean; checked: boolean; onCheck: (id: number, v: boolean) => void; onChanged: () => void;
  onUndo?: (id: number) => void; undoing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = selectable && checked;
  return (
    <div className={`rounded-xl border bg-surface transition-colors ${active ? 'border-brand-500/60 bg-brand-500/[0.04]' : 'border-line'}`}>
      <div className="flex items-center gap-3 p-2.5">
        {selectable && (
          <label className="flex shrink-0 cursor-pointer items-center" title="Tanlash">
            <input type="checkbox" checked={checked} onChange={(e) => onCheck(r.caseId, e.target.checked)} aria-label="Tanlash" className="peer sr-only" />
            <span className={`grid h-5 w-5 place-items-center rounded-md border-2 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/30 ${checked ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-surface text-transparent hover:border-brand-500/60'}`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>
            </span>
          </label>
        )}
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${avatarColor(r.pinfl || '')}`} aria-hidden>{initials(r.clientName)}</span>
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setOpen((v) => !v)} title="Mijoz hujjatlarini ochish">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{r.clientName || '—'}</span>
            {statusChip(r)}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span className="tabular-nums">{r.pinfl}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5">{r.stageLabel}</span>
            <DueBadge d={r.daysLeft} />
          </div>
        </div>
        {/* Sud uchun 4 ta shart (talabnoma·check·skan·oferta), so'ng ajratilgan «boji» — ma'lumot uchun. */}
        <div className="flex shrink-0 items-center gap-1.5" title="Sud sharti (5 tasi ham MAJBURIY): Talabnoma · Check (kvitansiya) · Skan · Oferta · Boji (invoice raqami)">
          <DocTile ok={r.talabnoma} label="Talabnoma" />
          {/* Check = talabnoma UZPOST kvitansiyasi biriktirilgan (MAJBURIY). Yonida hippo-delivered ko'rsatkichi. */}
          <DocTile ok={r.receipt} label="Check" />
          {!r.receipt && r.talabnomaDelivered && (
            <Tip label="xat.hippo yetkazilgan, lekin kvitansiya hali biriktirilmagan — «Cheklarni biriktirish»" className="shrink-0">
              <span className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300">hippo✓</span>
            </Tip>
          )}
          <DocTile ok={r.scan} label="Skan" />
          <DocTile ok={r.oferta} label="Oferta" />
          {/* Boji = invoice RAQAMI (receiptNumber) bor — endi MAJBURIY (raqam ariza ichiga yoziladi). */}
          <DocTile ok={r.boji} label="Boji" />
        </div>
        <span className="hidden w-24 shrink-0 text-right text-sm font-semibold tabular-nums sm:block">{sum(r.totalDebt)}</span>
        {/* «Bekor» — qatorning o'zida (modalga kirmasdan): yuborilgan/qoralama → «Tayyor»ga qaytaradi. */}
        {(r.exported || r.draft) && onUndo && (
          <Tip label="Bekor qilib «Tayyor»ga qaytarish" className="shrink-0">
            <button onClick={() => onUndo(r.caseId)} disabled={undoing} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] font-medium text-rose-600 outline-none transition-colors hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/30 disabled:opacity-50 dark:text-rose-300">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
              {undoing ? '…' : 'Bekor'}
            </button>
          </Tip>
        )}
        {/* Har mijozni ochib hujjatlarini koʻrish + qoʻshimcha biriktirish (tayyor boʻlsa ham). */}
        <Tip label={r.ready ? 'Mijoz hujjatlari — koʻrish va qoʻshimcha biriktirish' : 'Yetishmagan hujjatlarni toʻldirish'} className="shrink-0">
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${r.ready ? 'border-line text-muted hover:border-brand-500/40 hover:text-fg' : 'border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'}`}>
            {r.ready ? 'Hujjatlar' : 'Toʻldirish'} {open ? '▲' : '▼'}
          </button>
        </Tip>
      </div>
      {/* Hujjatlar boshqa qadamlardagidek MODALda ochiladi (inline emas — ro'yxat joyida turadi). */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={r.clientName || 'Mijoz hujjatlari'}
        description={`${r.pinfl ?? ''} · ${r.stageLabel}`}
        size="xl"
        footer={
          <>
            {(r.exported || r.draft) && onUndo && (
              <button
                onClick={() => onUndo(r.caseId)}
                disabled={undoing}
                className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-600 outline-none transition-colors hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/30 disabled:opacity-50 dark:text-rose-300"
                title={`${r.exported ? 'Yuborilgan' : 'Qoralama'}ni bekor qilib «Tayyor»ga qaytaradi`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
                {undoing ? 'Bekor qilinmoqda…' : 'Bekor qilish'}
              </button>
            )}
            <button onClick={onChanged} className="btn-ghost text-xs">Yangilash</button>
            <button onClick={() => setOpen(false)} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600">Yopish</button>
          </>
        }
      >
        <CaseDocs caseId={r.caseId} firmId={firmId} stage={r.stage} receiptNumber={r.receiptNumber} talabnomaSent={r.talabnoma} onChange={onChanged} courtFlags={{ talabnoma: r.talabnoma, scan: r.scan, oferta: r.oferta, receipt: r.receipt, boji: r.boji }} />
      </Modal>
    </div>
  );
});

function ClientDrilldown({ firmId, snapshotId, job, startExport, onChanged }: {
  firmId: number; snapshotId?: number; job?: JobState;
  startExport: (caseIds: number[]) => void; onChanged: () => void;
}) {
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
      const d = await getJson(`/konveyer/court-ready/clients?${qs.toString()}`, { cache: 'no-store' });
      if (my !== reqRef.current) return;
      setData(d); loadedOnce.current = true;
    } catch (e) {
      if (my !== reqRef.current) return;
      setError(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); // keep the previous rows visible
    } finally { if (my === reqRef.current) { setLoading(false); setRefreshing(false); } }
  }, [firmId, snapshotId]);
  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => { load(); onChanged(); }, [load, onChanged]);
  // Tab sonlari — mahalliy `data.rows`dan hisoblanadi (server `counts` emas). Shunda bitta qatorni
  // OPTIMISTIK o'zgartirsak (undo), sonlar DARROV to'g'rilanadi — butun ro'yxatni qayta yuklash shart emas.
  const counts = React.useMemo<ClientCounts | undefined>(() => {
    if (!data) return undefined;
    const c: ClientCounts = { all: 0, sendable: 0, draft: 0, ready: 0, exported: 0, submitted: 0, notready: 0 };
    // «Chiqarilgan» va «Sudda» — ATAYIN bir-birini istisno qiladi: sudga ketgan ish
    // «Chiqarilgan» sanog'ida turmaydi, aks holda bitta ish ikki joyda ko'rinadi.
    for (const r of data.rows) { c.all++; if (r.sendable) c.sendable++; if (r.draft) c.draft++; if (r.ready) c.ready++; if (r.submitted) c.submitted++; else if (r.exported) c.exported++; if (!r.ready) c.notready++; }
    return c;
  }, [data]);
  // Bitta qatorni joyida yangilash (optimistik) — to'liq refetch/flash yo'q.
  const patchRow = useCallback((caseId: number, patch: Partial<ClientRow>) => {
    setData((prev) => (prev ? { ...prev, rows: prev.rows.map((row) => (row.caseId === caseId ? { ...row, ...patch } : row)) } : prev));
  }, []);
  const running = !!job && (job.status === 'PENDING' || job.status === 'RUNNING');

  // «Bekor qilish» — kalit SHART EMAS: oddiy tasdiq modali («rostdan bekor qilaymi?») → so'ng «Tayyor»ga
  // qaytaradi. Backend: POST /konveyer/court-undo (meta.exportedAt/draftAt olib tashlanadi).
  const undo = useCallback(async (caseId: number) => {
    const ok = await confirm({
      title: 'Yuborishni bekor qilish',
      description: 'Rozimisiz? Mijoz sud paketidan chiqarilib, «Tayyor»ga qaytadi.',
      confirmLabel: 'Ha, bekor qilish', danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch('/konveyer/court-undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseIds: [caseId] }) });
      if (!res.ok) return;
      // OPTIMISTIK: faqat o'sha qator «Tayyor»ga qaytadi — butun ro'yxat qayta yuklanmaydi (flash yo'q).
      const row = data?.rows.find((r) => r.caseId === caseId);
      const backToReady = !!row && row.ready && !['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED'].includes(row.stage);
      patchRow(caseId, { exported: false, draft: false, sendable: backToReady });
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
      const okFilter = filter === 'sendable' ? r.sendable : filter === 'draft' ? r.draft : filter === 'ready' ? r.ready : filter === 'submitted' ? !!r.submitted : filter === 'notready' ? !r.ready : true;
      if (!okFilter) continue;
      const k = String(r.courtId ?? 'none');
      const it = m.get(k) ?? { id: r.courtId ?? null, name: r.courtName ?? 'Sud tayinlanmagan', enabled: r.courtEnabled !== false, count: 0 };
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

  const filtered = React.useMemo(() => {
    const src = data?.rows ?? [];
    const needle = debouncedQ.trim().toLowerCase();
    return src.filter((r) => {
      const okFilter = filter === 'sendable' ? r.sendable : filter === 'draft' ? r.draft : filter === 'ready' ? r.ready : filter === 'submitted' ? !!r.submitted : filter === 'notready' ? !r.ready : true;
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
        {CLIENT_FILTERS.map((f) => {
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
              {f.label}
              {cnt != null && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${active ? 'bg-black/[0.06] dark:bg-white/10' : 'bg-surface text-muted'}`}>{n(cnt)}</span>}
            </button>
          );
        })}
      </div>

      {/* search */}
      <div className="relative mb-2">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Mijoz qidirish" placeholder="F.I.O yoki PINFL…" className="w-full rounded-xl border border-line bg-surface py-2 pl-10 pr-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" />
      </div>

      {/* SUD bo'yicha filtr — firma ishlari bir necha sudga bo'lingan bo'lsa ko'rinadi.
          Yopiq sud (ADOLAT qabul qilmaydi) alohida belgilanadi, chunki undagi ishlarni
          tanlash mumkin bo'lsa-da, yuborish baribir xato beradi. */}
      {courtOptions.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted">Sud:</span>
          <button
            onClick={() => { setCourtFilter('all'); setPage(1); }}
            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${courtFilter === 'all' ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2'}`}
          >
            Hammasi
          </button>
          {courtOptions.map((c) => {
            const on = courtFilter === c.id;
            return (
              <button
                key={String(c.id ?? 'none')}
                onClick={() => { setCourtFilter(c.id); setPage(1); }}
                title={c.enabled ? undefined : 'ADOLAT’da bu sud elektron ariza qabul qilmaydi'}
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
              Bu sud ADOLAT’da elektron ariza qabul qilmaydi — yuborish xato beradi. Sud administratori yoqishi kerak.
            </span>
          )}
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : error && !data ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-[12px] font-medium text-rose-500" role="alert">
          <span>{error}</span>
          <button onClick={() => load()} className="rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">Qayta urinish</button>
        </div>
      ) : (
        <div className={refreshing ? 'opacity-60 transition-opacity duration-200' : 'transition-opacity duration-200'}>
          {error && <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" role="alert">Yangilanmadi — eski roʻyxat koʻrsatilyapti.</div>}
          {rows.length === 0 ? (
            // A filter/search switch refetches; the OLD filter's rows may be empty, so show a skeleton
            // while the new list loads instead of a false «Bu filtrda mijoz yoʻq».
            refreshing
              ? <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />)}</div>
              : <div className="rounded-lg border border-line bg-surface px-3 py-6 text-center text-sm text-muted">{debouncedQ ? `«${debouncedQ}» topilmadi` : 'Bu filtrda mijoz yoʻq.'}</div>
          ) : (
            <>
              {/* Yopishib turadigan YUQORI panel — belgilash + «Sudga yuborish» doim ko'rinadi (pastda qolmaydi). */}
              {filter === 'sendable' && selectableIds.length > 0 && (
                <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium" title="Barcha tayyorlarni belgilash">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Hammasini belgilash" className="peer sr-only" />
                    <span className={`grid h-5 w-5 place-items-center rounded-md border-2 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/30 ${allSelected ? 'border-brand-500 bg-brand-500 text-white' : someSelected ? 'border-brand-500 bg-brand-500/15 text-brand-600 dark:text-brand-400' : 'border-line bg-surface text-transparent hover:border-brand-500/60'}`}>
                      {allSelected
                        ? <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>
                        : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round"><path d="M6 12h12" /></svg>}
                    </span>
                    Hammasini belgilash{filtered.length > MAX_COURT_BATCH ? ` (birinchi ${MAX_COURT_BATCH})` : ''}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted">{n(selected.size)} / {n(filtered.length)}</span>
                    {selected.size > 0 && (
                      <>
                        <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs">Bekor</button>
                        <button onClick={doExport} disabled={running} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-brand-600 disabled:opacity-40">
                          <IcoBolt /> Sudga yuborish ({n(selected.size)})
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
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">Oldingi</button>
                  <span className="text-xs tabular-nums text-muted">Sahifa {page} / {pages} · {n(filtered.length)} ta</span>
                  <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">Keyingi</button>
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
// ── Umumiy pauza: BUTUN sudga yuborish jarayonini to'xtatib turadi ────────────────────────
// «Bekor» dan farqi: u bitta partiyani tugatadi, bu esa barcha firmalarga taalluqli va
// bazada saqlanadi — deploy/restart'dan keyin ham kuchda qoladi. Pauzada ishlar navbatda
// (PENDING) qoladi va davom ettirilganda aynan shu joydan ketadi.
function PauseSwitch() {
  const [paused, setPaused] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);

  // Holat + BARCHA firmalar bo'yicha umumiy raqamlar. Ish ketayotgan bo'lsa tez-tez
  // yangilanadi (operator jarayonni real vaqtda kuzatadi), tinch paytda sekinroq.
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/konveyer/court-queue/pause')
      .then((r) => r.json())
      .then((d) => { if (alive) { setPaused(d?.paused === true); setCounts(d?.counts ?? null); } })
      .catch(() => { if (alive) setPaused((p) => p ?? false); });
    void load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const toggle = async () => {
    if (paused === null || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/konveyer/court-queue/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !paused }),
      });
      if (r.ok) setPaused((await r.json())?.paused === true);
    } catch { /* tarmoq xatosi — holat o'zgarmaydi */ } finally { setBusy(false); }
  };

  const waiting = (counts?.PENDING ?? 0) + (counts?.RUNNING ?? 0);
  const done = counts?.DONE ?? 0;
  const failed = counts?.FAILED ?? 0;
  const running = (counts?.RUNNING ?? 0) > 0;

  if (paused === null) return null;
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
        paused
          ? 'border-amber-500/45 bg-amber-500/[0.07]'
          : 'border-line bg-surface'
      }`}
    >
      {/* Holat nuqtasi — faol bo'lsa sekin puls, pauzada tinch. */}
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
        {!paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/70" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${paused ? 'bg-amber-500' : 'bg-emerald-500'}`} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-[12px] font-semibold ${paused ? 'text-amber-700 dark:text-amber-300' : 'text-fg'}`}>
            {paused ? 'Sudga yuborish to‘xtatilgan' : running ? 'Yuborilmoqda' : 'Sudga yuborish faol'}
          </span>
          {/* Umumiy raqamlar — barcha firmalar bo'yicha, bir qarashda.
              `role="status"` + `aria-atomic` bitta MA'NOLI jumla bilan: har 5 soniyada
              yangilanadigan uchta alohida raqam ekran o'quvchida bir-biriga xalaqit berardi
              (yoki umuman e'lon qilinmasdi). Bitta atomik xabar — bitta tushunarli holat. */}
          {counts && (waiting + done + failed) > 0 && (
            <span
              className="flex flex-wrap items-center gap-1 text-[11px] tabular-nums"
              role="status"
              aria-atomic="true"
              aria-label={`Sudga yuborish: ${n(done)} ketdi, ${n(waiting)} navbatda, ${n(failed)} yuborilmadi`}
            >
              {waiting > 0 && (
                <span className="rounded bg-slate-500/12 px-1.5 py-0.5 font-medium text-slate-600 dark:text-slate-300" title="Navbatda va ishlanmoqda">
                  {n(waiting)} navbatda
                </span>
              )}
              {done > 0 && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-300" title="ADOLAT qabul qilgan">
                  {n(done)} ketdi
                </span>
              )}
              {failed > 0 && (
                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-medium text-rose-700 dark:text-rose-300" title="Xato bergan — firma qatoridagi navbat panelidan sababini ko‘ring">
                  {n(failed)} yuborilmadi
                </span>
              )}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-muted">
          {paused
            ? waiting > 0
              ? `${n(waiting)} ta ish navbatda kutib turibdi. Davom ettirsangiz aynan shu joydan ketadi — hech narsa takrorlanmaydi.`
              : 'Yangi partiya boshlanmaydi. Davom ettirmaguningizcha portalga hech nima yuborilmaydi.'
            : running
              ? 'Har ish orasida sud sozlamasidagi interval kutiladi (Sudlar bo‘limi, standart 60s).'
              : 'Barcha firmalar bo‘yicha jarayonni bir tugma bilan to‘xtatib turish mumkin.'}
        </div>
      </div>

      <button
        onClick={toggle}
        disabled={busy}
        title={paused ? 'Jarayonni davom ettirish' : 'Butun jarayonni vaqtincha to‘xtatish'}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          paused
            ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/[0.18] focus-visible:ring-emerald-500/30 dark:text-emerald-300'
            : 'border-line text-muted hover:border-amber-500/45 hover:bg-amber-500/10 hover:text-amber-700 focus-visible:ring-amber-500/30 dark:hover:text-amber-300'
        }`}
      >
        {busy ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
        ) : paused ? (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
        ) : (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" /></svg>
        )}
        {busy ? 'Kutilmoqda' : paused ? 'Davom ettirish' : 'Pauza'}
      </button>
    </div>
  );
}

// ── Sudga yuborish navbati: HAR BIR ISH bo'yicha holat ────────────────────────────────────
// Job progress'i «3/100» deydi, lekin qaysi ish yiqilgani va NEGA — ko'rinmaydi. Operator
// aynan shuni bilishi kerak: xato bergan ishni topib, sababini o'qib, tuzatib qayta yuborish.
type QueueRow = {
  caseId: number; clientName: string | null; pinfl: string | null; state: string;
  error: string | null; draftId: string | null; caseNumber: string | null; attempts: number; step?: string | null;
};
const Q_STATE: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Navbatda', tone: 'bg-slate-500/12 text-slate-600 dark:text-slate-300' },
  RUNNING: { label: 'Ketyapti…', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  DONE: { label: 'Yuborildi', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  FAILED: { label: 'Yuborilmadi', tone: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  SKIPPED: { label: 'Oʻtkazildi', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
};

function QueuePanel({ firmId, live }: { firmId: number; live: boolean }) {
  const [data, setData] = useState<{ counts: Record<string, number>; rows: QueueRow[] } | null>(null);
  const [open, setOpen] = useState(false);

  const [err, setErr] = useState<string | null>(null);

  // FIRMA darajasidagi pauza — umumiy pauzadan mustaqil. Bitta firmani to'xtatib
  // qo'yib, boshqasining partiyasini o'tkazib yuborish uchun (2026-09-07: BRIGHT'ning
  // 200 taligi ketayotganda URBAN'ning 3 tasi ~3 soat kutib qolgan edi).
  const [firmPaused, setFirmPaused] = useState<boolean | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);

  const loadPause = useCallback(async () => {
    try {
      const d = await getJson<{ pausedFirms?: number[] }>('/konveyer/court-queue/pause');
      setFirmPaused((d?.pausedFirms ?? []).includes(firmId));
    } catch { /* holat belgisi — o'qilmasa tugma ko'rsatilmaydi */ }
  }, [firmId]);

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
      setData(await getJson(`/konveyer/court-queue?firmId=${firmId}`));
      setErr(null);
    } catch (e) {
      // Avval bu jimgina yutilardi — sessiya tugaganda panel eski raqamlarni ko'rsatib
      // turaverardi va operator ular hozirgi holat deb o'ylardi.
      setErr(e instanceof Error ? e.message : 'Navbat holatini o‘qib bo‘lmadi');
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
  const waiting = (counts?.PENDING ?? 0) + (counts?.RUNNING ?? 0);
  if (err) {
    return (
      <div className="border-t border-line px-3 py-2 text-[11px] text-rose-500" role="alert">
        {err}
      </div>
    );
  }
  if (!counts || (failed + done + waiting) === 0) return null;

  const total = done + waiting + failed;
  const donePct = total ? Math.round((done / total) * 100) : 0;
  const failPct = total ? Math.round((failed / total) * 100) : 0;

  return (
    <div className={`border-t border-line px-3 py-2.5 ${firmPaused ? 'bg-amber-500/[0.05]' : ''}`}>
      {/* Firma darajasidagi pauza — faqat navbatda ish bo'lsa ma'noli. */}
      {firmPaused !== null && waiting > 0 && (
        <div className="mb-1.5 flex items-center gap-2">
          {firmPaused && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              ⏸ Bu firma to‘xtatilgan
            </span>
          )}
          <button
            onClick={toggleFirmPause}
            disabled={pauseBusy}
            title={firmPaused
              ? 'Shu firmani davom ettirish'
              : 'Faqat SHU firmani to‘xtatish — boshqa firmalar ishlayveradi'}
            className={`ml-auto rounded-lg border px-2 py-0.5 text-[10px] font-semibold outline-none transition-colors focus-visible:ring-2 disabled:opacity-50 ${
              firmPaused
                ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/[0.18] focus-visible:ring-emerald-500/30 dark:text-emerald-300'
                : 'border-line text-muted hover:border-amber-500/45 hover:bg-amber-500/10 hover:text-amber-700 focus-visible:ring-amber-500/30 dark:hover:text-amber-300'
            }`}
          >
            {pauseBusy ? '…' : firmPaused ? 'Davom ettirish' : 'Shu firmani to‘xtatish'}
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30"
        aria-expanded={open}
      >
        {/* Bitta chiziqda butun manzara: yashil = ketgan, kulrang = navbatda, qizil = xato. */}
        <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${donePct}%` }} />
          <span className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${failPct}%` }} />
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
          {done > 0 && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{n(done)} ketdi</span>}
          {waiting > 0 && <span className="text-muted">{n(waiting)} navbatda</span>}
          {/* Taxminiy vaqt — har ish ~60s. Busiz ro'yxat «qotib qolgan»dek ko'rinadi:
              operator har daqiqada bittadan ketayotganini bilmasa, xato deb o'ylaydi. */}
          {live && waiting > 0 && (
            <span className="text-muted" title="Har ish orasida sud sozlamasidagi interval (standart 60s)">
              ≈{waiting >= 60 ? `${Math.round(waiting / 60)} soat` : `${waiting} daq`}
            </span>
          )}
          {failed > 0 && <span className="font-semibold text-rose-600 dark:text-rose-400">{n(failed)} yuborilmadi</span>}
          <svg
            className={`h-3.5 w-3.5 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
          ><path d="m6 9 6 6 6-6" /></svg>
        </span>
      </button>

      {open && data && (
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-0.5">
          {data.rows.map((row, i) => {
            const st = Q_STATE[row.state] ?? Q_STATE.PENDING;
            const failedRow = row.state === 'FAILED';
            return (
              <li
                key={row.caseId}
                className={`rounded-lg border px-2 py-1.5 text-[11px] ${failedRow ? 'border-rose-500/30 bg-rose-500/[0.05]' : 'border-transparent bg-surface-2'}`}
              >
                <div className="flex items-center gap-2">
                  {/* Tartib raqami — 99 ta ish orasida qaysi biri qayerdaligini ko'rish uchun. */}
                  <span className="w-6 shrink-0 text-right tabular-nums text-muted">{i + 1}.</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${st.tone}`}>{st.label}</span>
                  <span className="min-w-0 truncate font-medium">{row.clientName || `#${row.caseId}`}</span>
                  {/* Ayni paytdagi bosqich — faqat ketayotgan ish uchun. Busiz «Ketyapti»
                      60 soniya qimirlamay turadi va qotib qolgandek ko'rinadi. */}
                  {row.state === 'RUNNING' && row.step && (
                    <span className="shrink-0 rounded bg-sky-500/12 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">{row.step}</span>
                  )}
                  {/* Urinishlar soni FAQAT muammoli qatorlarda ko'rsatiladi. Muvaffaqiyatli
                      ishda «necha urinishda ketdi» ahamiyatsiz, lekin «Yuborildi» yonida
                      turgan «2×» operatorni chalkashtiradi (nima 2 marta bo'ldi — yuborildimi?). */}
                  {row.attempts > 1 && row.state !== 'DONE' && (
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted" title="Shuncha marta urinilgan">
                      {row.attempts}-urinish
                    </span>
                  )}
                  {row.caseNumber && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-emerald-600 dark:text-emerald-400" title="Sud ish raqami">
                      {row.caseNumber}
                    </span>
                  )}
                </div>
                {/* Xato sababi to'liq — operator shu matndan nima qilishni tushunadi. */}
                {failedRow && row.error && (
                  <p className="mt-1 break-words leading-snug text-rose-600 dark:text-rose-300" role="alert">{row.error}</p>
                )}
                {/* Xato bo'lsa ham qoralama yaratilgan bo'lishi mumkin — ADOLAT'da yetim qolmasin. */}
                {failedRow && row.draftId && (
                  <p className="mt-0.5 font-mono text-[10px] text-muted">ADOLAT qoralama: {row.draftId}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FirmSendRow({ fr, snapshotId, job, startExport, onZip, onChanged, drillOpen, onToggleDrill, idx, autoActive, onStopAuto }: {
  fr: FirmReadiness; snapshotId?: number; job?: JobState;
  startExport: (firmId: number, extra: Record<string, unknown>) => void;
  onZip?: () => void;
  onChanged: () => void; drillOpen: boolean; onToggleDrill: () => void; idx: number;
  autoActive?: boolean; onStopAuto?: () => void;
}) {
  const pct = fr.total ? (fr.ready / fr.total) * 100 : 0;
  const [includeExported, setIncludeExported] = useState(false); // «qaytadan» — allaqachon yuborilganlarni ham qo'shish
  const docsOk = fr.docs?.complete !== false; // firma hujjatlari (guvohnoma/ishonchnoma/shartnoma) to'liqmi
  const docsMissing = fr.docs?.missing ?? [];
  const docsTip = docsOk
    ? 'Firma hujjatlari to‘liq: guvohnoma, ishonchnoma, shartnoma'
    : `Firma hujjatlari yetishmaydi: ${docsMissing.join(', ')}. Firmalar → firma → «Hujjatlar»dan yuklang. To‘liq bo‘lmaguncha sudga yuborib bo‘lmaydi.`;

  return (
    <div className={`animate-fade-in rounded-xl border bg-surface transition-colors ${docsOk ? 'border-line hover:border-brand-500/40' : 'border-amber-500/40 bg-amber-500/[0.03]'}`} style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <ReadinessRing pct={pct} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`truncate font-semibold ${docsOk ? '' : 'text-muted'}`} title={fr.firmName}>{fr.firmName}</span>
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted">{n(fr.total)} jami</span>
            {/* Firma hujjatlari holati — ustiga borilsa qaysilari kerak/yetishmayotgani ko'rinadi. */}
            <span
              title={docsTip}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${docsOk ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'}`}
            >
              {docsOk
                ? <><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>Hujjatlar</>
                : <><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>Hujjat yetishmaydi</>}
            </span>
          </div>
          {/* Yetishmagan firma hujjatlari — aniq qaysilari (rasmga mos: guvohnoma/ishonchnoma/shartnoma). */}
          {!docsOk && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
              {FIRM_DOCS_ALL.map((k) => {
                const miss = docsMissing.includes(k);
                return (
                  <span key={k} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${miss ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300' : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'}`} title={miss ? `${k} yetishmaydi` : `${k} bor`}>
                    {miss ? '✕' : '✓'} {k}
                  </span>
                );
              })}
              <span className="text-muted">— Firmalar boʻlimidan yuklang</span>
            </div>
          )}
          {/* Firma qatorida FAQAT ish oqimiga aloqador holatlar: Tayyor emas · Tayyor · Qoralama · Sudda.
              «Chiqarilgan» (ZIP olingan) ATAYIN yo'q — u sudga yuborishga ta'sir qilmaydi (ZIP olingan ish
              baribir «Tayyor»da qoladi) va qatorda faqat chalg'itardi. Batafsil ko'rish kerak bo'lsa,
              «Batafsil» ochilganda tab sifatida chiqadi.
              «Batafsil» YOPIQ paytda ko'rinadi (ochiq bo'lsa xuddi shu tab'lar pastda chiqadi). */}
          {!drillOpen && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {CLIENT_FILTERS.filter((f) => f.key !== 'all').map((f) => (
                <span key={f.key} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-[11px] font-medium" title={f.label}>
                  <span className={f.iconCls}>{f.icon}</span>
                  <span className="text-muted">{f.label}</span>
                  <span className="font-semibold tabular-nums">{n(firmStatValue(fr, f.key))}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {autoActive ? (
          <div className="inline-flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Auto{job && (job.status === 'RUNNING' || job.status === 'PENDING') ? ' · yuborilyapti' : ' · keyingi partiya 60s dan keyin'}
            </span>
            <button type="button" onClick={() => onStopAuto?.()} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-2.5 py-1.5 text-xs font-semibold text-rose-600 outline-none transition-colors hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/30 dark:text-rose-300">
              To‘xtatish
            </button>
          </div>
        ) : docsOk ? (
          <div className="flex items-center gap-2">
            {/* ZIP — hujjatlarni faylga chiqarish. Sudga YUBORMAYDI: portalga tegmaydi,
                shuning uchun pauza va sud limiti unga taalluqli emas. */}
            <button
              type="button"
              onClick={() => onZip?.()}
              disabled={fr.sendable === 0}
              title={fr.sendable > 0 ? `${fr.sendable} ta tayyor mijoz hujjatlarini bitta ZIP qilib yuklab olish` : 'Tayyor mijoz yo‘q'}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IcoDown /> ZIP
            </button>
            <ExportControl job={job} sendable={fr.sendable} onStart={() => startExport(fr.firmId, {})} />
          </div>
        ) : (
          <button type="button" disabled title={docsTip}
            className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 opacity-90 dark:text-amber-300">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Firma hujjatlari kerak
          </button>
        )}

        <button onClick={onToggleDrill} aria-expanded={drillOpen} title="Mijozlarni koʻrish — kimda nima yetishmayapti, hujjat biriktirish" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted outline-none transition-colors hover:border-brand-500/40 hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          Batafsil
          <svg className={`h-3 w-3 transition-transform ${drillOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>

      {/* Navbat holati — ish ketayotganda ham, tugagach ham ko'rinadi (xatolar yo'qolib
          ketmasligi uchun: operator sababni keyin ham o'qiy oladi). */}
      <QueuePanel firmId={fr.firmId} live={!!job && (job.status === 'PENDING' || job.status === 'RUNNING')} />
      {drillOpen && (
        <ClientDrilldown firmId={fr.firmId} snapshotId={snapshotId} job={job} startExport={(caseIds) => startExport(fr.firmId, { caseIds })} onChanged={onChanged} />
      )}
    </div>
  );
}

function ReturnRow({ r, idx }: { r: ReturnCase; idx: number }) {
  const [open, setOpen] = useState(false);
  const isCourt = r.stage === 'COURT_RETURNED';
  return (
    <div className="animate-fade-in rounded-xl border border-line bg-surface" style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/30">
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${isCourt ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>{isCourt ? 'Sud qaytardi' : 'Palatadan'}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{r.clientName || '—'}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span className="tabular-nums">{r.pinfl}</span>
            <span className="max-w-[10rem] truncate rounded bg-surface-2 px-1.5 py-0.5 font-medium" title={r.firmName}>{r.firmName}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5">{r.docCount} hujjat</span>
          </div>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{sum(r.totalDebt)}</span>
        <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>
      {open && (
        <div className="border-t border-line bg-surface-2/30 p-3">
          <div className="mb-2 text-[11px] text-muted">Qo'shimcha fayllarni to'ldiring (palata skan / firma hujjatlari), so'ng «Hammasini yarat» bilan qayta paket oling.</div>
          <CaseDocs caseId={r.caseId} firmId={r.firmId} stage={r.stage} receiptNumber={r.receiptNumber} talabnomaSent={r.talabnomaSent} />
        </div>
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

// ── main ─────────────────────────────────────────────────────────────────────
export function CourtManager({ firms, selectedId, initialData, tab = 'send' }: { firms: { firmId: number; firmName: string; total: number; stir?: string | null }[]; selectedId?: number; initialData?: Data | null; tab?: 'send' | 'stat' | 'returns' }) {
  const confirmQ = useConfirm(); // navbatni to'xtatish/tozalash — qaytarib bo'lmaydigan amallar
  const [firmId, setFirmId] = useState<number | null>(null);
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
  const [pendingQ, setPendingQ] = useState<{ firmId: number; firmName: string; stir: string | null; pending: number; running: number; job?: { jobId: number; status: string; progress: number; total: number; queuePos: number } | null }[]>([]);
  const loadPending = useCallback(() => {
    fetch('/konveyer/court-queue/pending')
      .then((r) => r.json())
      .then((d) => setPendingQ(Array.isArray(d?.firms) ? d.firms : []))
      .catch(() => { /* tarmoq xatosi — keyingi tsiklda qayta o'qiladi */ });
  }, []);
  useEffect(() => {
    loadPending();
    const t = setInterval(loadPending, 10_000);
    return () => clearInterval(t);
  }, [loadPending]);
  const [statSource, setStatSource] = useState<'CABINET' | 'HIPPO' | 'all'>('CABINET'); // Sud vs Talabnoma segment
  const reqRef = useRef(0);
  const loadedOnce = useRef(!!initialData);
  // The page server-renders the initial (firm=all) payload → skip the duplicate mount fetch.
  const skipMount = useRef(!!initialData);

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
      const d = await getJson(`/konveyer/court-ready?${qs.toString()}`, { cache: 'no-store' });
      if (my !== reqRef.current) return null;
      setData(d); setLastLoaded(new Date()); loadedOnce.current = true;
      return d as Data;
    } catch (e) {
      if (my !== reqRef.current) return null;
      setError(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); // keep stale data — no setData(null)
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
  useEffect(() => {
    if (!anyJobRunning) return;
    const t = setInterval(() => { void loadRef.current(); }, 20_000);
    return () => clearInterval(t);
  }, [anyJobRunning]);

  // `endpoint` — odatda partiya tanlash (prepare-ready), lekin navbatni DAVOM ETTIRISHDA
  // boshqa yo'l ishlatiladi (court-queue/resume): u yangi tanlov qilmaydi, bazadagi PENDING
  // ishlarni oladi. Shuning uchun manzil parametr bo'ldi.
  const startJob = useCallback((key: string, body: Record<string, unknown>, onDone: () => void, endpoint = '/konveyer/prepare-ready') => {
    if (timers.current[key]) return; // already running
    setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'PENDING', progress: 0, total: 0 } }));
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'FAILED', progress: 0, total: 0, error: d?.error || 'Xatolik' } })); return; }
        setJobs((j) => ({ ...j, [key]: { jobId: d.jobId, status: 'PENDING', progress: 0, total: d.total, type: d.type } }));
        let pollFails = 0;
        timers.current[key] = setInterval(async () => {
          try {
            const s = await getJson(`/api/jobs/${d.jobId}`);
            pollFails = 0;
            setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], status: s.status, progress: s.progress, total: s.total, message: s.message ?? undefined } } : j));
            if (s.status === 'DONE' || s.status === 'FAILED') {
              clearInterval(timers.current[key]); delete timers.current[key];
              if (s.status === 'DONE') onDone();
            }
          } catch (e) {
            // Bitta-ikkita uzilish — tarmoq g'ijimi, davom etamiz. Lekin ketma-ket 5 marta
            // (~10s) yiqilsa sabab jiddiy (odatda sessiya tugagan): avval bu jimgina yutilardi
            // va progress abadiy qotib qolardi — operator ish ketyapti deb o'ylab turaverardi.
            if (++pollFails >= 5) {
              clearInterval(timers.current[key]); delete timers.current[key];
              const msg = e instanceof Error ? e.message : 'Holatni o‘qib bo‘lmadi';
              setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], error: msg } } : j));
            }
          }
        }, 2000);
      })
      .catch(() => setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'FAILED', progress: 0, total: 0, error: 'Tarmoq xatosi' } })));
  }, []);

  const snapshotId = data?.snapshotId ?? selectedId;

  // ── AUTO rejim: bir marta imzolangach, keyingi PARTIYAlarni o'zi boshlaydi ─────────────────
  // (partiya tugagach AUTO_MS kutib, firma hali tayyor bo'lsa keyingisini boshlaydi; tayyor tugasa yoki
  //  «To'xtatish» bosilsa — to'xtaydi). Qayta E-IMZO so'ralmaydi — operator auto'ni yoqib tasdiqlagan.
  // AUTO rejim: partiya tugagach keyingisi shuncha kutib boshlanadi. 30s edi — portal
  // tezlik cheklovi uchun juda tez (bir partiya tugashi bilan darrov keyingisi urilardi).
  const AUTO_MS = 60_000;
  const [auto, setAuto] = useState<{ firmId: number; firmName: string; limit: number } | null>(null);
  const autoRef = useRef<typeof auto>(null);
  useEffect(() => { autoRef.current = auto; }, [auto]);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAuto = useCallback(() => { if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null; } setAuto(null); }, []);
  useEffect(() => () => { if (autoTimer.current) clearTimeout(autoTimer.current); }, []);

  // The real job runner — only reached AFTER the firm's adolat E-IMZO key is signed (yoki auto davomida).
  // Navbatni davom ettirish — kalit bilan tasdiqlanadi (yuborish bilan bir xil talab),
  // so'ng bazadagi PENDING ishlardan yangi partiya boshlanadi.
  const runResume = (fid: number) =>
    startJob(`firm:${fid}`, { firmId: fid, limit: MAX_COURT_BATCH }, () => { void loadRef.current(); loadPending(); }, '/konveyer/court-queue/resume');

  const runExport = (fid: number, extra: Record<string, unknown> = {}) =>
    startJob(`firm:${fid}`, { firmId: fid, snapshotId, limit: MAX_COURT_BATCH, ...extra }, async () => {
      const fresh = await loadRef.current();
      // AUTO: shu firma auto'da bo'lsa — tayyor qolgan bo'lsa AUTO_MS dan keyin keyingisi.
      const a = autoRef.current;
      if (a && a.firmId === fid) {
        const fr = fresh?.readiness.firms.find((f) => f.firmId === fid);
        const left = fr?.sendable ?? 0;
        if (left > 0) { autoTimer.current = setTimeout(() => { if (autoRef.current?.firmId === fid) runExport(fid, { limit: a.limit }); }, AUTO_MS); }
        else setAuto(null); // tayyor tugadi — auto to'xtaydi
      }
    });
  // «Sudga yuborish» → E-IMZO gate: aniq so'roq (summary) → firma kaliti → parol → yuboriladi.
  // (Bekor qilish kalit talab qilmaydi — u ClientDrilldown ichida oddiy tasdiq modali bilan.)
  const [gate, setGate] = useState<{ firmId: number; firmName: string; stir: string | null; extra: Record<string, unknown>; summary: string } | null>(null);
  // «Sudga yuborish» (firma darajasida) → avval SONI so'raladi (max MAX_COURT_BATCH), keyin E-IMZO gate.
  // Drilldownда qo'lda tanlanган (caseIds) yoki soni allaqachon berilган bo'lsa — to'g'ridan gate.
  const [countAsk, setCountAsk] = useState<{ firmId: number; firmName: string; max: number; value: number; auto: boolean } | null>(null);
  // ZIP eksport modali — sudga YUBORMAYDI, faqat hujjatlarni bitta arxivga yig'adi.
  const [zipAsk, setZipAsk] = useState<{ firmId: number; firmName: string; max: number; value: number } | null>(null);
  const openGate = (fid: number, extra: Record<string, unknown> = {}) => {
    const f = firms.find((x) => x.firmId === fid);
    const ids = (extra as { caseIds?: unknown }).caseIds;
    const lim = (extra as { limit?: unknown }).limit;
    const cnt = Array.isArray(ids) ? ids.length : (typeof lim === 'number' ? lim : null);
    setGate({
      firmId: fid, firmName: f?.firmName ?? `Firma ${fid}`, stir: f?.stir ?? null, extra,
      summary: cnt != null ? `${cnt} ta mijozni sudga yuborasiz. Firma kaliti bilan tasdiqlang.` : `Tayyor mijozlarni (bir martada ≤${MAX_COURT_BATCH}) sudga yuborasiz. Firma kaliti bilan tasdiqlang.`,
    });
  };
  const startExport = (fid: number, extra: Record<string, unknown> = {}) => {
    const ids = (extra as { caseIds?: unknown }).caseIds;
    // Qo'lda tanlanган yoki soni berilган → to'g'ridan gate. Aks holda — soni so'raymiz.
    if (Array.isArray(ids) || (extra as { limit?: unknown }).limit != null) { openGate(fid, extra); return; }
    const fr = data?.readiness.firms.find((f) => f.firmId === fid);
    const max = Math.min(MAX_COURT_BATCH, fr?.sendable ?? 0);
    if (max <= 0) return; // yuboriladigan yo'q
    setCountAsk({ firmId: fid, firmName: fr?.firmName ?? `Firma ${fid}`, max, value: max, auto: false });
  };

  // ── «Sudga yuborish» modalidagi SUD taqsimoti (ko'rsatkich) ──────────────────
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
  type QItem = { id: string; firmId: number; firmName: string; stir: string | null; count: number; courtIds?: number[]; status: 'wait' | 'signing' | 'sending' | 'done' | 'error' };
  const [queue, setQueue] = useState<QItem[]>([]);
  const [queueActive, setQueueActive] = useState(false);
  const signedFirms = useRef<Set<number>>(new Set());
  const [queueGate, setQueueGate] = useState<{ itemId: string; firmId: number; firmName: string; stir: string | null; count: number } | null>(null);
  const qidRef = useRef(0);
  const addToQueue = (fid: number, fname: string, stir: string | null, count: number, courtIds?: number[]) =>
    setQueue((q) => [...q, { id: `q${++qidRef.current}`, firmId: fid, firmName: fname, stir, count, courtIds, status: 'wait' as const }]);

  useEffect(() => {
    if (!queueActive) return;
    const cur = queue.find((x) => x.status !== 'done' && x.status !== 'error');
    if (!cur) { setQueueActive(false); return; }
    if (cur.status === 'sending') {
      const job = jobs[`queue:${cur.id}`];
      if (job && (job.status === 'DONE' || job.status === 'FAILED')) {
        setQueue((q) => q.map((x) => (x.id === cur.id ? { ...x, status: job.status === 'DONE' ? 'done' : 'error' } : x)));
        loadRef.current();
      }
      return;
    }
    if (cur.status === 'signing') return; // gate ochiq — imzo kutilyapti
    // cur.status === 'wait'
    if (signedFirms.current.has(cur.firmId)) {
      setQueue((q) => q.map((x) => (x.id === cur.id ? { ...x, status: 'sending' } : x)));
      startJob(`queue:${cur.id}`, { firmId: cur.firmId, snapshotId, limit: cur.count, ...(cur.courtIds?.length ? { courtIds: cur.courtIds } : {}) }, () => {});
    } else {
      setQueue((q) => q.map((x) => (x.id === cur.id ? { ...x, status: 'signing' } : x)));
      setQueueGate({ itemId: cur.id, firmId: cur.firmId, firmName: cur.firmName, stir: cur.stir, count: cur.count });
    }
  }, [jobs, queue, queueActive, snapshotId, startJob]);

  const firmOpts = [{ value: 'all', label: 'Hamma firma' }, ...firms.map((f) => ({ value: String(f.firmId), label: f.firmName, hint: n(f.total) }))];
  const ov = data?.readiness.overall;
  const board = data?.statusBoard;
  const returns = data?.returns ?? [];
  const overallPct = ov && ov.total ? (ov.ready / ov.total) * 100 : 0;

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          {lastLoaded && <span className="hidden text-[11px] text-muted sm:inline">Yangilangan: <span className="tabular-nums">{lastLoaded.toLocaleTimeString('ru-RU')}</span></span>}
          {/* EXCEL EKSPORTLARI.
              Ilgari bu yerda yolg'iz «Statistika» havolasi turardi va boshqa ikkita eksport
              (sudga qaytganlar, mijozlar ro'yxati) UI'dan umuman ko'rinmasdi — operator ular
              borligini bilmasdi. Endi uchalasi bitta menyuda, har biri nima berishi yozilgan. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setXlsOpen((v) => !v)}
              aria-expanded={xlsOpen}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-xs font-semibold text-fg outline-none transition-colors hover:border-brand-500/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30"
            >
              <svg className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 3v18M3 8h5M3 13h5M3 18h5" /></svg>
              Excel
              <svg className={`h-3.5 w-3.5 text-muted transition-transform ${xlsOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {xlsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setXlsOpen(false)} aria-hidden />
                <div className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
                  {[
                    { href: `/konveyer/court-stats-excel${selectedId ? `?s=${selectedId}` : ''}`, title: 'Firma statistikasi', hint: 'Har firma: jami · tayyor · sudda · yetishmayotgan hujjatlar' },
                    { href: `/konveyer/cases-excel${selectedId ? `?s=${selectedId}` : ''}${firmId ? `${selectedId ? '&' : '?'}firmId=${firmId}` : ''}`, title: 'Mijozlar ro‘yxati', hint: 'F.I.O · PINFL · firma · qarzdorlik · boji · muddat' },
                    { href: `/konveyer/court-returns-excel${selectedId ? `?s=${selectedId}` : ''}${firmId ? `${selectedId ? '&' : '?'}firmId=${firmId}` : ''}`, title: 'Suddan qaytganlar', hint: 'Qayta yuborish uchun ishlash ro‘yxati' },
                    { href: `/konveyer/unpaid-receipts-excel${firmId ? `?firmId=${firmId}` : ''}`, title: 'To‘lanmagan kvitansiyalar', hint: 'Buxgalteriya uchun: to‘lov kutayotgan ishlar · raqam · summa' },
                  ].map((x) => (
                    <a
                      key={x.href}
                      href={x.href}
                      onClick={() => setXlsOpen(false)}
                      className="block border-b border-line px-3 py-2 text-left outline-none transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2"
                    >
                      <span className="block text-[12px] font-medium">{x.title}</span>
                      <span className="block text-[11px] leading-snug text-muted">{x.hint}</span>
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
          <Tip label="Yangilash" side="bottom">
            <button onClick={() => load()} disabled={refreshing} aria-label="Yangilash" className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50">
              <IcoRefresh spin={refreshing} />
            </button>
          </Tip>
          <Dropdown value={firmId ? String(firmId) : 'all'} options={firmOpts} onChange={(v) => { setFirmId(v === 'all' ? null : Number(v)); setOpenFirm(null); }} className="w-full sm:w-auto sm:min-w-[200px]" />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-2 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : !data ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-[12px] font-medium text-rose-500" role="alert">
          <span>{error ?? 'Yuklab boʻlmadi'}</span>
          <button onClick={() => load()} className="rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">Qayta urinish</button>
        </div>
      ) : (
        <div className={refreshing ? 'opacity-60 transition-opacity duration-200' : 'transition-opacity duration-200'}>
          {error && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" role="alert">
              <span>Yangilanmadi ({error}) — eski maʼlumot koʻrsatilyapti.</span>
              <button onClick={() => load()} className="rounded border border-line px-1.5 py-0.5 hover:border-amber-500/50">Qayta</button>
            </div>
          )}

          {tab === 'send' ? (
            <div key="send" className="animate-fade-in space-y-3">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-stretch">
                <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
                  <ReadinessRing pct={overallPct} size={88} sw={8} />
                  <div>
                    <div className="text-[11px] font-medium text-muted">Umumiy tayyorlik</div>
                    <div className="text-sm font-semibold">{n(ov!.ready)} / {n(ov!.total)} mijoz</div>
                    <div className="mt-0.5 text-[11px] text-muted">{n(ov!.sendable)} ta tayyor</div>
                  </div>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Jami" value={ov!.total} icon={statIcon('all')} hint="Tanlangan firma/snapshot bo'yicha" />
                  <Stat label="Tayyor" value={ov!.sendable} tone="emerald" icon={statIcon('sendable')} hint="Talabnoma + skan + oferta + check + boji (invoice raqami) bor, hali yuborilmagan — shu tab'dan yuboriladi" />
                  <Stat label="Qoralama" value={ov!.draft} tone="violet" icon={statIcon('draft')} hint="Sinab ko'rilgan (hali haqiqiy yuborilmagan)" />
                  {/* «Sudda» — ATAYIN `submitted`, `exported` EMAS. Ilgari bu karta ZIP
                      olingan ishlarni ham qo'shib «Yuborilgan 131» deb ko'rsatardi, holbuki
                      ularning ko'pi sudga ketmagan edi (2026-09-07: BRIGHT'da 100 tasi ZIP). */}
                  <Stat label="Sudda" value={ov!.submitted} tone="indigo" icon={statIcon('submitted')} hint="ADOLAT orqali sudga rasman topshirilgan da'volar" />
                </div>
              </div>
              {(ov!.almost.scan + ov!.almost.oferta + ov!.almost.talabnoma + ov!.almost.receipt + ov!.almost.boji) > 0 && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5">
                  <AlmostLine almost={ov!.almost} />
                  <div className="mt-1 text-[11px] text-muted">Bittagina hujjat yetmaydi — o'shani to'ldirsangiz darhol sudga chiqadi. Sud uchun 5 ta shart (hammasi majburiy): talabnoma + imzolangan skan + oferta + check (UZPOST kvitansiya) + boji (invoice raqami). Invoice PDF sudga ketmaydi, lekin raqami ariza ichida ketadi. Odatda «faqat skan» yoki «faqat check» eng katta guruh.</div>
                </div>
              )}
              <div className="rounded-lg border border-line bg-surface-2/30 px-3 py-2 text-[11px] leading-relaxed text-muted">
                Faqat <b className="font-medium text-fg">to'liq tayyor</b> (talabnoma, imzolangan skan, oferta, check/kvitansiya, boji — invoice raqami) mijozlar sudga yuboriladi. Har firma <b className="font-medium text-fg">alohida</b>, bir martada <b className="font-medium text-fg">max {MAX_COURT_BATCH} ta</b>. Grafik qo'shilmaydi. «Batafsil» — kim tayyor, kimda nima yetishmayotganini ko'rish, hujjat biriktirish.
              </div>
              {queue.length > 0 && (
                <div className="rounded-xl border border-brand-500/30 bg-brand-500/[0.05] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">Yuborish navbati — {n(queue.filter((x) => x.status !== 'done' && x.status !== 'error').length)} qoldi</span>
                    <div className="flex items-center gap-1.5">
                      {!queueActive ? (
                        <button type="button" onClick={() => setQueueActive(true)} disabled={!queue.some((x) => x.status === 'wait')}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"><IcoBolt /> Boshlash</button>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            const left = queue.filter((x) => x.status === 'wait').length;
                            const ok = await confirmQ({
                              title: 'Navbatni to‘xtatishmi?',
                              description: left > 0
                                ? `Ketayotgan partiya oxirigacha boradi, keyin to‘xtaydi. Navbatda ${n(left)} ta partiya qoladi — keyin «Boshlash» bilan davom ettirishingiz mumkin.`
                                : 'Ketayotgan partiya oxirigacha boradi, keyin yangi partiya boshlanmaydi.',
                              confirmLabel: 'Ha, to‘xtatilsin', danger: true,
                            });
                            if (ok) setQueueActive(false);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2.5 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-500/10 dark:text-rose-300">To‘xtatish</button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          const drop = queue.filter((x) => x.status !== 'sending' && x.status !== 'signing').length;
                          if (drop === 0) return;
                          const ok = await confirmQ({
                            title: 'Navbat tozalansinmi?',
                            description: `${n(drop)} ta yozuv ro‘yxatdan o‘chiriladi (ketayotgani qoladi). Yuborilgan ishlarga ta’sir qilmaydi — faqat navbat ro‘yxati tozalanadi.`,
                            confirmLabel: 'Ha, tozalansin', danger: true,
                          });
                          if (ok) setQueue((q) => q.filter((x) => x.status === 'sending' || x.status === 'signing'));
                        }}
                        className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-brand-500/40 hover:text-fg">Tozalash</button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {queue.map((it) => {
                      const job = jobs[`queue:${it.id}`];
                      const pct = job && job.total ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0;
                      const badge = it.status === 'done' ? ['bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', 'tayyor']
                        : it.status === 'error' ? ['bg-rose-500/15 text-rose-600 dark:text-rose-300', 'xato']
                        : it.status === 'sending' ? ['bg-brand-500/15 text-brand-700 dark:text-brand-300', 'yuborilyapti']
                        : it.status === 'signing' ? ['bg-amber-500/15 text-amber-700 dark:text-amber-300', 'imzo']
                        : ['bg-surface-2 text-muted', 'navbatda'];
                      return (
                        <div key={it.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs">
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge[0]}`}>{badge[1]}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{it.firmName} · {n(it.count)} ta</span>
                          {it.status === 'sending' && <span className="shrink-0 tabular-nums text-muted">{n(job?.progress ?? 0)}/{n(job?.total || it.count)} ({pct}%)</span>}
                          {it.status === 'wait' && (
                            <button type="button" onClick={() => setQueue((q) => q.filter((x) => x.id !== it.id))} title="Navbatdan o‘chirish"
                              className="shrink-0 rounded px-1 text-muted transition-colors hover:text-rose-500">✕</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-muted">Ketma-ket yuboriladi. Har firma uchun kalit bir marta so‘raladi. Xato bo‘lsa keyingisiga o‘tadi.</p>
                </div>
              )}
              <PauseSwitch />
              {/* NAVBATDA QOLGANLAR — bazadan tiklangan.
                  Sahifa yangilansa ham ko'rinadi: manba React state emas, CourtQueueItem.
                  Operator «Davom ettirish» bilan aynan qolgan ishlardan davom etadi —
                  yangi tanlov qilinmaydi, tartib buzilmaydi, hech narsa takrorlanmaydi. */}
              {pendingQ.length > 0 && (
                <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <svg className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                    <span className="text-[12px] font-semibold text-amber-700 dark:text-amber-300">Navbatda qolgan ishlar</span>
                    <span className="text-[11px] text-muted">Yakunlanmagan partiya — o‘sha joydan davom etadi</span>
                  </div>
                  <div className="space-y-1.5">
                    {pendingQ.map((q) => (
                      <div key={q.firmId} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-xs">
                        <span className="min-w-0 flex-1 truncate font-medium">{q.firmName}</span>
                        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted">
                          {n(q.pending + q.running)} ta navbatda
                        </span>
                        {q.job?.status === 'RUNNING' ? (
                          <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-sky-700 dark:text-sky-300">
                            ketmoqda {n(q.job.progress)}/{n(q.job.total)}
                          </span>
                        ) : q.job?.status === 'PENDING' ? (
                          /* Worker bir vaqtda bitta partiya bajaradi — bu firma o'z navbatini
                             kutyapti. O'rnini ko'rsatamiz, aks holda «nega boshlanmayapti?». */
                          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300" title={`Partiya #${q.job.jobId} navbatda — oldingisi tugagach o'zi boshlanadi`}>
                            navbatda · {q.job.queuePos}-o‘rin
                          </span>
                        ) : q.running > 0 ? (
                          <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">ketmoqda</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setGate({ firmId: q.firmId, firmName: q.firmName, stir: q.stir, extra: { resume: true }, summary: `${q.firmName} — navbatda qolgan ${n(q.pending)} ta ishni davom ettirish` })}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-600"
                          >
                            <IcoBolt /> Davom ettirish
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {data.readiness.firms.length === 0
                  ? <EmptyBlock title="Bu snapshotda mijoz yoʻq" hint="Sidebar sanasini tekshiring yoki Hisobotda konveyerni yangilang." />
                  : data.readiness.firms.map((fr, i) => (
                    <FirmSendRow
                      key={fr.firmId}
                      fr={fr}
                      idx={i}
                      snapshotId={snapshotId}
                      job={jobs[`firm:${fr.firmId}`]}
                      startExport={startExport}
                      onZip={() => setZipAsk({ firmId: fr.firmId, firmName: fr.firmName, max: fr.sendable, value: Math.min(100, fr.sendable) })}
                      onChanged={load}
                      drillOpen={openFirm === fr.firmId}
                      onToggleDrill={() => setOpenFirm((o) => (o === fr.firmId ? null : fr.firmId))}
                      autoActive={auto?.firmId === fr.firmId}
                      onStopAuto={clearAuto}
                    />
                  ))}
              </div>
            </div>
          ) : tab === 'stat' ? (
            <div key="stat" className="animate-fade-in space-y-3">
              {board!.total === 0 ? (
                <EmptyBlock title="Status olinmagan" hint="«Ulanishlar» orqali firma kalitini ulab sud (adolat) va talabnoma (pochta) holatlarini yangilang — qanoatlantirilgan, qaytarilgan, rad, yetkazildi… hammasi shu yerda ko'rinadi." />
              ) : (() => {
                const cab = board!.sources.CABINET ?? 0;
                const hip = board!.sources.HIPPO ?? 0;
                const segs: { key: 'CABINET' | 'HIPPO' | 'all'; label: string; count: number }[] = [
                  { key: 'CABINET', label: 'Sud (adolat)', count: cab },
                  { key: 'HIPPO', label: 'Talabnoma', count: hip },
                  { key: 'all', label: 'Hammasi', count: board!.total },
                ];
                // If the default (Sud) has nothing but Talabnoma does, show Talabnoma instead.
                const eff: 'CABINET' | 'HIPPO' | 'all' = statSource === 'CABINET' && cab === 0 && hip > 0 ? 'HIPPO' : statSource;
                const shown = eff === 'all' ? board!.buckets : board!.buckets.filter((b) => b.source === eff);
                const shownTotal = shown.reduce((s, b) => s + b.count, 0) || 1;
                return (
                  <>
                    {/* Sud / Talabnoma / Hammasi — court outcomes are NOT drowned by 3600+ delivery rows */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex rounded-xl border border-line bg-surface-2/50 p-0.5">
                        {segs.map((s) => (
                          <button
                            key={s.key}
                            onClick={() => setStatSource(s.key)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${eff === s.key ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
                          >
                            {s.label}
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${eff === s.key ? 'bg-brand-500/15 text-brand-600 dark:text-brand-400' : 'bg-surface-2 text-muted'}`}>{n(s.count)}</span>
                          </button>
                        ))}
                      </div>
                      <span className="text-[11px] text-muted">Mijozga bogʻlangan: <b className="font-semibold text-fg tabular-nums">{n(board!.matched)}</b></span>
                    </div>

                    {shown.length === 0 ? (
                      <EmptyBlock title="Bu boʻlimda status yoʻq" hint={eff === 'CABINET' ? 'Sud (adolat) holatlari hali yangilanmagan.' : 'Talabnoma yetkazish holatlari yoʻq.'} />
                    ) : (
                      <>
                        {/* legend (touch-friendly — the bar's title= tooltips are dead on touch) */}
                        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted">
                          {shown.map((b) => (
                            <span key={`${b.source}:${b.code}`} className="inline-flex items-center gap-1">
                              <span className="h-2 w-2 rounded-full" style={{ background: BAR[b.tone] ?? BAR.slate }} />
                              {b.label} <b className="font-semibold text-fg tabular-nums">{n(b.count)}</b>
                            </span>
                          ))}
                        </div>
                        <div className="flex h-3 overflow-hidden rounded-full">
                          {shown.map((b) => <span key={`${b.source}:${b.code}`} title={`${b.label}: ${n(b.count)}`} style={{ width: `${(b.count / shownTotal) * 100}%`, background: BAR[b.tone] || BAR.slate }} />)}
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                          {shown.map((b) => (
                            <div key={`${b.source}:${b.code}`} className={`rounded-xl border border-line p-3 ${TONE[b.tone] || TONE.slate}`}>
                              <div className="text-2xl font-bold tabular-nums">{n(b.count)}</div>
                              <div className="mt-0.5 truncate text-[12px] font-medium" title={b.label}>{b.label}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <div key="returns" className="animate-fade-in space-y-2">
              {returns.length === 0
                ? <EmptyBlock title="Qaytgan ish yoʻq" hint="Sud yoki palata qaytarganda shu yerda ko'rinadi — to'ldirib qayta yuborasiz." />
                : (
                  <>
                    <div className="rounded-lg border border-line bg-surface-2/30 px-3 py-2 text-[11px] leading-relaxed text-muted">
                      Sud yoki palata qaytargan ishlar. Har birini ochib, yetishmagan <b className="font-medium text-fg">fayllarni to'ldiring</b>, so'ng qayta paket oling va qayta yuboring.
                    </div>
                    {returns.map((r, i) => <ReturnRow key={r.caseId} r={r} idx={i} />)}
                  </>
                )}
            </div>
          )}
        </div>
      )}

      {/* ZIP eksport — hujjatlarni bitta arxivga yig'ib yuklab olish.
          Sudga YUBORMAYDI: portalga bitta ham so'rov ketmaydi, shuning uchun E-IMZO,
          pauza va sud kunlik limiti bu yerda qo'llanmaydi. */}
      {zipAsk && (
        <Modal
          open
          onClose={() => setZipAsk(null)}
          title={`ZIP yuklab olish — ${zipAsk.firmName}`}
          description={`Tayyor mijozlarning hujjatlari bitta arxivga yig'iladi. Sudga yuborilmaydi.`}
          footer={<>
            <button className="btn-ghost" type="button" onClick={() => setZipAsk(null)}>Bekor</button>
            <button
              className="btn-primary" type="button"
              disabled={!zipAsk.value || zipAsk.value < 1}
              onClick={() => {
                const v = Math.max(1, Math.min(zipAsk.max, Math.floor(zipAsk.value) || 0));
                const fid = zipAsk.firmId;
                setZipAsk(null);
                // exportOnly: sudga yuborish emas, faqat ZIP (PACKET job).
                // runExport — to'g'ridan-to'g'ri, E-IMZO gate'siz: ZIP portalga bitta ham
                // so'rov yubormaydi, shuning uchun kalit bilan tasdiqlash mantiqsiz edi.
                runExport(fid, { limit: v, exportOnly: true });
              }}
            >
              ZIP tayyorlash ({Math.max(1, Math.min(zipAsk.max, Math.floor(zipAsk.value) || 0))})
            </button>
          </>}
        >
          <div className="space-y-3">
            <label className="field-label">Nechta mijoz
              <input
                type="number" min={1} max={Math.min(100, zipAsk.max)} autoFocus
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm tabular-nums outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                value={zipAsk.value}
                onChange={(e) => setZipAsk((c) => c && ({ ...c, value: Math.max(1, Math.min(c.max, Number(e.target.value) || 0)) }))}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[10, 25, 50, 100].filter((x) => x <= Math.min(100, zipAsk.max)).map((x) => (
                <button key={x} type="button" onClick={() => setZipAsk((c) => c && ({ ...c, value: x }))}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${zipAsk.value === x ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2'}`}>
                  {x}
                </button>
              ))}
              {zipAsk.max > 0 && (
                <button type="button" onClick={() => setZipAsk((c) => c && ({ ...c, value: Math.min(100, c.max) }))}
                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2">
                  hammasi ({Math.min(100, zipAsk.max)})
                </button>
              )}
            </div>
            <div className="rounded-lg border border-line p-2.5 text-[11px] leading-snug text-muted">
              <span className="font-medium text-fg">Filtr: «Tayyor»</span> — 5 shart to'liq bajarilgan mijozlar
              (talabnoma + imzolangan skan + oferta + kvitansiya + boji). Arxivda har mijoz uchun
              alohida papka bo'ladi. Bir martada eng ko'pi 100 ta.
            </div>
          </div>
        </Modal>
      )}

      {countAsk && (
        <Modal open onClose={() => { setCountAsk(null); setPickedCourts(null); }} title={`Sudga yuborish — ${countAsk.firmName}`} description={`Bir martada eng ko'pi ${Math.min(100, countAsk.max)} ta. Nechtasini yuborasiz?`}
          footer={<>
            <button className="btn-ghost" type="button" onClick={() => setCountAsk(null)}>Bekor</button>
            <button className="btn-ghost" type="button"
              disabled={!countAsk.value || countAsk.value < 1 || (pickedCourts !== null && pickedCourts.length === 0)}
              title="Navbatga qo'shish — bir nechta partiyani ketma-ket yuborish (skayner kabi)"
              onClick={() => { const v = Math.max(1, Math.min(countAsk.max, Math.floor(countAsk.value) || 0)); const f = firms.find((x) => x.firmId === countAsk.firmId); addToQueue(countAsk.firmId, countAsk.firmName, f?.stir ?? null, v, pickedCourts ?? undefined); setCountAsk(null); }}>
              + Navbatga
            </button>
            <button className="btn-primary" type="button"
              disabled={!countAsk.value || countAsk.value < 1 || (pickedCourts !== null && pickedCourts.length === 0)}
              onClick={() => { const v = Math.max(1, Math.min(countAsk.max, Math.floor(countAsk.value) || 0)); const fid = countAsk.firmId; const au = countAsk.auto; const cs = pickedCourts; setCountAsk(null); openGate(fid, { limit: v, auto: au, ...(cs && cs.length ? { courtIds: cs } : {}) }); }}>
              {countAsk.auto ? 'Auto boshlash' : 'Yuborish'} ({Math.max(1, Math.min(countAsk.max, Math.floor(countAsk.value) || 0))})
            </button>
          </>}
        >
          <div className="space-y-3">
            <label className="block">
              <span className="field-label">Soni (1–{Math.min(100, countAsk.max)})</span>
              <input type="number" min={1} max={Math.min(100, countAsk.max)} value={countAsk.value}
                onChange={(e) => { const raw = Math.floor(Number(e.target.value) || 0); setCountAsk((c) => c && ({ ...c, value: Math.max(0, Math.min(c.max, raw)) })); }}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm tabular-nums outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30" autoFocus />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[10, 25, 50, 100].filter((q) => q <= countAsk.max).map((q) => (
                <button key={q} type="button" onClick={() => setCountAsk((c) => c && ({ ...c, value: q }))}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${countAsk.value === q ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:border-brand-500/40'}`}>{q}</button>
              ))}
              {countAsk.max < 100 && (
                <button type="button" onClick={() => setCountAsk((c) => c && ({ ...c, value: c.max }))}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${countAsk.value === countAsk.max ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:border-brand-500/40'}`}>Hammasi ({countAsk.max})</button>
              )}
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-2.5">
              <input type="checkbox" checked={countAsk.auto} onChange={(e) => setCountAsk((c) => c && ({ ...c, auto: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-brand-500" />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">Auto — partiyalarni ketma-ket davom ettirish</span>
                <span className="block text-[11px] text-muted">
                  Bir martada eng ko‘pi 100 ta yuboriladi. Auto yoqilsa, partiya tugagach keyingisi
                  o‘zi boshlanadi va kalit qayta so‘ralmaydi — tayyorlar tugaguncha (yoki «To‘xtatish»gacha).
                  Ishlar orasidagi kutish esa doim bor: u sud sozlamasidan olinadi (standart 60s).
                </span>
              </span>
            </label>
            {courtBreak && courtBreak.firmId === countAsk.firmId && courtBreak.courts.length > 0 && (
              <div className="rounded-lg border border-line p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-muted">Qaysi sudga yuborilsin? (tayyor {n(courtBreak.total)} ta)</span>
                  {pickedCourts !== null && (
                    <button onClick={() => setPickedCourts(null)} className="text-[11px] font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">hammasi</button>
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
                        title={closed ? (c.note ?? 'Bu sud ADOLAT orqali elektron ariza qabul qilmaydi')
                          : selectable ? undefined : 'Bu ishlarga sud hali biriktirilmagan — firmaning asosiy sudiga ketadi'}
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
                                {c.note ?? 'ADOLAT’da elektron qabul yoqilmagan — sud administratori hal qiladi'}
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
                  <p className="mt-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">Hech bo‘lmasa bitta sud tanlanishi kerak.</p>
                )}
                <p className="mt-1.5 text-[10px] leading-snug text-muted">Boshqa sudga allaqachon biriktirilgan ishlar tanlangan sudga ko‘chirilmaydi — ular keyingi safarga qoladi.</p>
              </div>
            )}
            <p className="text-[11px] text-muted">Eng eski (muddati yaqin) tayyor mijozlardan boshlab olinadi.</p>
          </div>
        </Modal>
      )}

      {gate && (
        <KeyPicker
          open
          onClose={() => setGate(null)}
          firm={{ firmId: gate.firmId, firmName: gate.firmName, stir: gate.stir }}
          provider="CABINET"
          endpoint="/konveyer/court-sign"
          title="Sudga yuborish — kalit bilan tasdiqlash"
          confirmLabel="Imzolab yuborish"
          summary={gate.summary}
          onSuccess={() => {
            const ex = gate.extra as { auto?: boolean; limit?: number; resume?: boolean };
            if (ex.resume) { runResume(gate.firmId); setGate(null); return; }
            if (ex.auto) setAuto({ firmId: gate.firmId, firmName: gate.firmName, limit: typeof ex.limit === 'number' ? ex.limit : 100 });
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
          title="Navbat — kalit bilan tasdiqlash"
          confirmLabel="Imzolab davom etish"
          summary={`${queueGate.firmName}: ${queueGate.count} ta sudga yuboriladi. Firma kaliti bilan tasdiqlang (bu firma uchun bir marta).`}
          onSuccess={() => { const g = queueGate; signedFirms.current.add(g.firmId); setQueue((q) => q.map((x) => (x.id === g.itemId ? { ...x, status: 'wait' } : x))); setQueueGate(null); }}
        />
      )}
    </div>
  );
}
