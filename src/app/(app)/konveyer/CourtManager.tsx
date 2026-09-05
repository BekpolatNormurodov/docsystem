'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, useConfirm } from '@/ui';
import { Dropdown } from './Dropdown';
import { CaseDocs } from './CaseDocs';
import { KeyPicker } from './KeyPicker';

// ── types (mirror src/lib/court-ready.ts) ────────────────────────────────────
interface Missing { talabnoma: number; scan: number; oferta: number; boji: number }
interface FirmDocsStatus { complete: boolean; missing: string[]; present: string[] }
interface FirmReadiness { firmId: number; firmName: string; total: number; ready: number; exported: number; draft: number; sendable: number; missing: Missing; almost: Missing; docs: FirmDocsStatus }
// Sud paketiga qo'shiladigan firma hujjatlari — 3 tasi ham kerak.
const FIRM_DOCS_ALL = ['guvohnoma', 'ishonchnoma', 'shartnoma'];
interface Overall { total: number; ready: number; exported: number; draft: number; sendable: number; missing: Missing; almost: Missing }
interface StatusBucket { code: string; label: string; tone: string; count: number; source: string }
interface StatusBoard { total: number; matched: number; buckets: StatusBucket[]; sources: Record<string, number> }
interface ReturnCase {
  caseId: number; clientName: string | null; pinfl: string | null; firmId: number; firmName: string;
  stage: string; stageLabel: string; receiptNumber: string | null; talabnomaSent: boolean;
  totalDebt: string; daysLeft: number | null; docCount: number;
}
interface Data { snapshotId?: number; readiness: { firms: FirmReadiness[]; overall: Overall }; statusBoard: StatusBoard; returns: ReturnCase[] }

type ReadyFilter = 'all' | 'sendable' | 'draft' | 'ready' | 'exported' | 'notready';
interface ClientRow {
  caseId: number; clientName: string | null; pinfl: string | null; stage: string; stageLabel: string;
  talabnoma: boolean; talabnomaDelivered: boolean; receipt: boolean; scan: boolean; oferta: boolean; boji: boolean;
  ready: boolean; exported: boolean; draft: boolean; sendable: boolean; totalDebt: string; daysLeft: number | null;
  receiptNumber: string | null;
}
interface ClientCounts { all: number; sendable: number; draft: number; ready: number; exported: number; notready: number }
interface ClientPage { rows: ClientRow[]; total: number; page: number; pageSize: number; pages: number; counts: ClientCounts; error?: string }

type JobState = { jobId: number; status: string; progress: number; total: number; error?: string };

const n = (x: number) => x.toLocaleString('ru-RU');
const sum = (v: string) => Number(v).toLocaleString('ru-RU');

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

// «1 qadam qolgan» — cases missing EXACTLY one gate doc, boji first (the usual bottleneck). Shows the
// operator exactly who is one document from court so the near-ready clients get finished first.
// boji is NOT a court-gate doc, so it never appears here — the gate is talabnoma + skan + oferta.
const ALMOST_DOCS: { key: keyof Missing; label: string; tone: string }[] = [
  { key: 'scan', label: 'skan', tone: 'bg-sky-500/12 text-sky-700 dark:text-sky-300' },
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
  const pct = job && job.total ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0;
  if (done && job) {
    // Keep the download AND, when the firm still has ready-not-exported cases,
    // a «Yana» button so batches of >100 aren't stuck after the first ZIP.
    return (
      <div className="flex flex-col items-end gap-1">
        <a href={`/api/export/${job.jobId}/download`} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 outline-none transition-colors hover:bg-emerald-500/15 focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-300">
          <IcoDown /> {job.total} ta ZIP — yuklab olish
        </a>
        {sendable > 0 && (
          <button onClick={onStart} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30" title={`Keyingi ${Math.min(100, sendable)} ta`}>
            <IcoBolt /> Yana ({Math.min(100, sendable)})
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
        title={sendable === 0 ? 'Sudga yuborishga tayyor mijoz yoʻq' : `${Math.min(100, sendable)} ta to'liq tayyor paketni sudga yuborish`}
      >
        {running
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {job?.progress ?? 0}/{job?.total ?? ''}</>
          : <><IcoBolt /> Sudga yuborish {sendable > 0 ? `(${Math.min(100, sendable)})` : ''}</>}
      </button>
      {running && job && job.total > 0 && (
        <span className="block h-1 w-28 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-brand-500 transition-all duration-500 ease-out" style={{ width: `${pct}%` }} /></span>
      )}
      {job?.status === 'FAILED' && <span className="text-[11px] font-medium text-rose-500" role="alert">{job.error || 'Xatolik'}</span>}
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
  { key: 'exported', label: 'Yuborilgan', icon: svg(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></>), activeCls: 'bg-sky-500/15 text-sky-600 dark:text-sky-300', iconCls: 'text-sky-500' },
  { key: 'all', label: 'Hammasi', icon: svg(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>), activeCls: 'bg-slate-500/15 text-slate-700 dark:text-slate-300', iconCls: 'text-slate-500' },
];
// Firma qatoridagi qisqa xulosa — tab'lar bilan bir xil ikon/rang (Tayyor emas · Tayyor · Qoralama · Yuborilgan),
// «batafsil» yopiq paytda ko'rinadi. `all` chiqmaydi (u umumiy jami).
const firmStatValue = (fr: FirmReadiness, key: ReadyFilter): number =>
  key === 'notready' ? fr.total - fr.ready : key === 'sendable' ? fr.sendable : key === 'draft' ? fr.draft : key === 'exported' ? fr.exported : fr.total;
const filterMeta = (key: ReadyFilter) => CLIENT_FILTERS.find((f) => f.key === key)!;
// Rangli ikon (summary kartalari uchun) — tab'lar bilan bir xil.
const statIcon = (key: ReadyFilter) => { const m = filterMeta(key); return <span className={m.iconCls}>{m.icon}</span>; };

function statusChip(r: ClientRow) {
  if (r.exported) return <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">Yuborilgan</span>;
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
        <div className="flex shrink-0 items-center gap-1.5" title="Sud sharti: Talabnoma · Check (kvitansiya) · Skan · Oferta   |   Boji — ma'lumot uchun (shart emas)">
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
          <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
          <DocTile ok={r.boji} label="Boji" optional />
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
        <CaseDocs caseId={r.caseId} firmId={firmId} stage={r.stage} receiptNumber={r.receiptNumber} talabnomaSent={r.talabnoma} onChange={onChanged} courtFlags={{ talabnoma: r.talabnoma, scan: r.scan, oferta: r.oferta, boji: r.boji }} />
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
      const res = await fetch(`/konveyer/court-ready/clients?${qs.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const d = await res.json();
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
    const c: ClientCounts = { all: 0, sendable: 0, draft: 0, ready: 0, exported: 0, notready: 0 };
    for (const r of data.rows) { c.all++; if (r.sendable) c.sendable++; if (r.draft) c.draft++; if (r.ready) c.ready++; if (r.exported) c.exported++; if (!r.ready) c.notready++; }
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
  const filtered = React.useMemo(() => {
    const src = data?.rows ?? [];
    const needle = debouncedQ.trim().toLowerCase();
    return src.filter((r) => {
      const okFilter = filter === 'sendable' ? r.sendable : filter === 'draft' ? r.draft : filter === 'ready' ? r.ready : filter === 'exported' ? r.exported : filter === 'notready' ? !r.ready : true;
      if (!okFilter) return false;
      if (needle && !`${r.clientName ?? ''} ${r.pinfl ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, filter, debouncedQ]);
  const pages = Math.max(1, Math.ceil(filtered.length / DRILL_PAGE));
  const rows = filtered.slice((page - 1) * DRILL_PAGE, (page - 1) * DRILL_PAGE + DRILL_PAGE);

  const toggle = useCallback((id: number, v: boolean) => setSelected((s) => { const next = new Set(s); if (v) next.add(id); else next.delete(id); return next; }), []);
  // «Hammasini belgilash» — barcha filtrlangan navbatdagilar, backend 100 cheklovi bilan (bir paket ≤100).
  const selectableIds = filter === 'sendable' ? filtered.map((r) => r.caseId).slice(0, 100) : [];
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
                    Hammasini belgilash{filtered.length > 100 ? ' (birinchi 100)' : ''}
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
function FirmSendRow({ fr, snapshotId, job, startExport, onChanged, drillOpen, onToggleDrill, idx }: {
  fr: FirmReadiness; snapshotId?: number; job?: JobState;
  startExport: (firmId: number, extra: Record<string, unknown>) => void;
  onChanged: () => void; drillOpen: boolean; onToggleDrill: () => void; idx: number;
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
          {/* Tab uslubidagi rangli xulosa (ikon + son): Tayyor emas · Tayyor · Qoralama · Yuborilgan.
              «Batafsil» YOPIQ paytda ko'rinadi (ochiq bo'lsa xuddi shu tab'lar pastda chiqadi). MiniStat va
              «1 qadam qolgan» satri olib tashlandi — kerak emas (har mijoz kartasida ko'rinadi). */}
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

        {docsOk ? (
          <ExportControl job={job} sendable={fr.sendable} onStart={() => startExport(fr.firmId, {})} />
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
  const [firmId, setFirmId] = useState<number | null>(null);
  const [data, setData] = useState<Data | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [openFirm, setOpenFirm] = useState<number | null>(null);
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
      const res = await fetch(`/konveyer/court-ready?${qs.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const d = await res.json();
      if (my !== reqRef.current) return;
      setData(d); setLastLoaded(new Date()); loadedOnce.current = true;
    } catch (e) {
      if (my !== reqRef.current) return;
      setError(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); // keep stale data — no setData(null)
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

  const startJob = useCallback((key: string, body: Record<string, unknown>, onDone: () => void) => {
    if (timers.current[key]) return; // already running
    setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'PENDING', progress: 0, total: 0 } }));
    fetch('/konveyer/prepare-ready', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'FAILED', progress: 0, total: 0, error: d?.error || 'Xatolik' } })); return; }
        setJobs((j) => ({ ...j, [key]: { jobId: d.jobId, status: 'PENDING', progress: 0, total: d.total } }));
        timers.current[key] = setInterval(async () => {
          try {
            const s = await (await fetch(`/api/jobs/${d.jobId}`)).json();
            setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], status: s.status, progress: s.progress, total: s.total } } : j));
            if (s.status === 'DONE' || s.status === 'FAILED') {
              clearInterval(timers.current[key]); delete timers.current[key];
              if (s.status === 'DONE') onDone();
            }
          } catch { /* transient poll error — keep polling */ }
        }, 2000);
      })
      .catch(() => setJobs((j) => ({ ...j, [key]: { jobId: 0, status: 'FAILED', progress: 0, total: 0, error: 'Tarmoq xatosi' } })));
  }, []);

  const snapshotId = data?.snapshotId ?? selectedId;
  // The real job runner — only reached AFTER the firm's adolat E-IMZO key is signed.
  const runExport = (fid: number, extra: Record<string, unknown> = {}) =>
    startJob(`firm:${fid}`, { firmId: fid, snapshotId, limit: 100, ...extra }, () => loadRef.current());
  // «Sudga yuborish» → E-IMZO gate: aniq so'roq (summary) → firma kaliti → parol → yuboriladi.
  // (Bekor qilish kalit talab qilmaydi — u ClientDrilldown ichida oddiy tasdiq modali bilan.)
  const [gate, setGate] = useState<{ firmId: number; firmName: string; stir: string | null; extra: Record<string, unknown>; summary: string } | null>(null);
  const startExport = (fid: number, extra: Record<string, unknown> = {}) => {
    const f = firms.find((x) => x.firmId === fid);
    const ids = (extra as { caseIds?: unknown }).caseIds;
    const cnt = Array.isArray(ids) ? ids.length : null;
    setGate({
      firmId: fid, firmName: f?.firmName ?? `Firma ${fid}`, stir: f?.stir ?? null, extra,
      summary: cnt != null ? `${cnt} ta tanlangan mijozni sudga yuborasiz. Firma kaliti bilan tasdiqlang.` : 'Tayyor mijozlarni (bir martada ≤100) sudga yuborasiz. Firma kaliti bilan tasdiqlang.',
    });
  };

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
          {/* Firma-statistika (xulosa) → Excel: jami / tayyor / yuborilgan / navbatda + yetishmayotgan hujjatlar. */}
          <a
            href={`/konveyer/court-stats-excel${selectedId ? `?s=${selectedId}` : ''}`}
            title="Firma statistikasi (xulosa) — Excel"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-xs font-semibold text-fg outline-none transition-colors hover:border-brand-500/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30"
          >
            <svg className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 3v18M3 8h5M3 13h5M3 18h5" /></svg>
            Statistika
          </a>
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
                  <Stat label="Tayyor" value={ov!.sendable} tone="emerald" icon={statIcon('sendable')} hint="Talabnoma + skan + oferta bor, hali yuborilmagan — shu tab'dan yuboriladi" />
                  <Stat label="Qoralama" value={ov!.draft} tone="violet" icon={statIcon('draft')} hint="Sinab ko'rilgan (hali haqiqiy yuborilmagan)" />
                  <Stat label="Yuborilgan" value={ov!.exported} tone="sky" icon={statIcon('exported')} hint="Haqiqiy sudga chiqarilgan" />
                </div>
              </div>
              {(ov!.almost.scan + ov!.almost.oferta + ov!.almost.talabnoma) > 0 && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5">
                  <AlmostLine almost={ov!.almost} />
                  <div className="mt-1 text-[11px] text-muted">Bittagina hujjat yetmaydi — o'shani to'ldirsangiz darhol sudga chiqadi. Sud uchun 3 ta shart: talabnoma + imzolangan skan + oferta (boji shart emas — kvitansiya raqami ariza ichida ketadi). Odatda «faqat skan» eng katta guruh: palatadan imzolangan arizani biriktiring.</div>
                </div>
              )}
              <div className="rounded-lg border border-line bg-surface-2/30 px-3 py-2 text-[11px] leading-relaxed text-muted">
                Faqat <b className="font-medium text-fg">to'liq tayyor</b> (talabnoma, imzolangan skan, oferta, davlat boji) mijozlar sudga yuboriladi. Har firma <b className="font-medium text-fg">alohida</b>, bir martada <b className="font-medium text-fg">max 100 ta</b>. Grafik qo'shilmaydi. «Batafsil» — kim tayyor, kimda nima yetishmayotganini ko'rish, hujjat biriktirish.
              </div>
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
                      onChanged={load}
                      drillOpen={openFirm === fr.firmId}
                      onToggleDrill={() => setOpenFirm((o) => (o === fr.firmId ? null : fr.firmId))}
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
          onSuccess={() => { runExport(gate.firmId, gate.extra); setGate(null); }}
        />
      )}
    </div>
  );
}
