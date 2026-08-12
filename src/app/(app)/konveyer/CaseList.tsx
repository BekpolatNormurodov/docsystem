'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Skeleton, Ico } from '@/ui';
import { CaseDocs } from './CaseDocs';

interface PersonCase {
  caseId: number;
  firmId: number;
  firmName: string;
  stage: string;
  stageLabel: string;
  receiptNumber: string | null;
  talabnomaSent: boolean;
  daysLeft: number | null;
  totalDebt: string;
}
interface Person {
  pinfl: string;
  clientName: string | null;
  kod: string | null;
  cases: PersonCase[];
  firmCount: number;
  totalDebt: string;
  minDaysLeft: number | null;
  hasInvoice: boolean;
}

const sum = (v: string) => Number(v).toLocaleString('ru-RU');
const PAGE_SIZE = 5;

// Small colored initial tile — a visual anchor for scanning the list. Colour is
// deterministic per person (from the PINFL) so a card keeps the same tile.
const AVATAR = [
  'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  'bg-teal-500/15 text-teal-600 dark:text-teal-300',
  'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
];
const avatarColor = (seed: string) => AVATAR[[...(seed || '0')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
const initials = (name: string | null) => ((name || '—').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—');

function DueBadge({ d }: { d: number | null }) {
  if (d === null) return <span className="text-muted/50">—</span>;
  if (d < 0) return <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-300">{Math.abs(d)} kun kechikdi</span>;
  if (d === 0) return <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">bugun</span>;
  return <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">{d} kun qoldi</span>;
}

// Case stage → pipeline phase index (0..4), for the mini progress indicator.
const STAGE_PHASE: Record<string, number> = {
  IMPORTED: 0, TALABNOMA_SENT: 0,
  ARIZA_GENERATED: 1, PRINTED: 1, CHAMBER_SENT: 1, CHAMBER_RETURNED: 1, SIGNED_SCANNED: 1,
  INVOICE_CREATED: 2, INVOICE_PAID: 2,
  COURT_SUBMITTED: 3, COURT_ACCEPTED: 3, COURT_RETURNED: 3,
  MIB_SUBMITTED: 4, CLOSED: 4,
};
const PHASE_META = [
  { label: 'Tayyorlash', c: '#64748b' },
  { label: 'Ariza · palata', c: '#8b5cf6' },
  { label: 'Invoice', c: '#f59e0b' },
  { label: 'Sud', c: '#3b82f6' },
  { label: 'Ijro', c: '#14b8a6' },
];
const TRACK = 'var(--line, rgba(120,120,120,0.22))';
function MiniSteps({ stage }: { stage: string }) {
  const idx = STAGE_PHASE[stage] ?? 0;
  const cur = PHASE_META[idx];
  return (
    <span className="inline-flex items-center gap-1" title={`Bosqich: ${cur.label} (${idx + 1}/5)`} aria-label={`Bosqich: ${cur.label}, ${idx + 1} / 5`}>
      {PHASE_META.map((_, i) => (
        <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: i === idx ? 16 : 7, background: i <= idx ? cur.c : TRACK }} />
      ))}
    </span>
  );
}

function CaseBlock({ c }: { c: PersonCase }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.firmName}</span>
        <MiniSteps stage={c.stage} />
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{c.stageLabel}</span>
        {c.daysLeft !== null && <DueBadge d={c.daysLeft} />}
        {c.receiptNumber
          ? <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-300">№{c.receiptNumber}</span>
          : <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-300">invoice yo‘q</span>}
        <span className="ml-auto text-sm font-semibold tabular-nums">{sum(c.totalDebt)}</span>
      </div>
      <CaseDocs caseId={c.caseId} firmId={c.firmId} stage={c.stage} receiptNumber={c.receiptNumber} talabnomaSent={c.talabnomaSent} />
    </div>
  );
}

function PersonCard({ p }: { p: Person }) {
  const [open, setOpen] = useState(false);
  const firms = [...new Set(p.cases.map((c) => c.firmName))];
  return (
    <div className="card overflow-hidden transition-shadow hover:shadow-sm">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2">
        {/* initial tile — visual anchor */}
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[13px] font-bold ${avatarColor(p.pinfl)}`} aria-hidden>{initials(p.clientName)}</span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold leading-tight">{p.clientName || '—'}</span>
            {p.cases.length > 1 && <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted">{p.cases.length} ish</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="tabular-nums text-muted">{p.pinfl}</span>
            {firms.map((fn) => (
              <span key={fn} className="max-w-[10rem] truncate rounded bg-surface-2 px-1.5 py-0.5 font-medium text-muted" title={fn}>{fn}</span>
            ))}
            {!p.hasInvoice && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-medium text-rose-600 dark:text-rose-300">invoice yo‘q</span>}
          </div>
        </div>

        {/* debt (always visible) + due badge */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-bold leading-none tabular-nums">{sum(p.totalDebt)} <span className="text-[10px] font-normal text-muted">so‘m</span></span>
          {p.minDaysLeft !== null && <DueBadge d={p.minDaysLeft} />}
        </div>
        <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-line bg-surface-2/30 p-3">
          {p.cases.map((c) => <CaseBlock key={c.caseId} c={c} />)}
        </div>
      )}
    </div>
  );
}

export function CaseList({ firmId, snapshotId, stages, talabnoma, phaseLabel }: { firmId?: number; snapshotId?: number; stages: string[]; talabnoma?: boolean; phaseLabel?: string }) {
  const [persons, setPersons] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0); // guards against out-of-order responses clobbering newer state

  // Depend on a stable primitive, not the array reference — a parent passing a
  // fresh `stages={[]}`/`[...]` each render must not refetch + reset the page.
  const stagesKey = stages.join(',');
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [debouncedQ, stagesKey]);

  const load = useCallback(async () => {
    const myReq = ++reqRef.current;
    setLoading(true); setError(null);
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (firmId) qs.set('firmId', String(firmId));
    if (snapshotId) qs.set('s', String(snapshotId));
    if (stages.length) qs.set('stages', stages.join(','));
    if (talabnoma) qs.set('talabnoma', '1');
    if (debouncedQ) qs.set('q', debouncedQ);
    try {
      const res = await fetch(`/konveyer/cases?${qs.toString()}`);
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const data = await res.json();
      if (myReq !== reqRef.current) return; // a newer request superseded this one
      setTotal(data.total ?? 0);
      setPages(data.pages ?? 1);
      setPersons(data.persons ?? []);
    } catch (e) {
      if (myReq !== reqRef.current) return;
      setError(e instanceof Error ? e.message : 'Yuklab bo‘lmadi');
      setPersons([]); setTotal(0); setPages(1);
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId, snapshotId, stagesKey, talabnoma, debouncedQ, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Mijoz qidirish (F.I.O, kod, PINFL)"
            placeholder={`Mijoz qidirish (F.I.O, kod, PINFL)${phaseLabel ? ` · ${phaseLabel}` : ''}…`}
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-9 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg" aria-label="Tozalash">
              <Ico.close size={13} />
            </button>
          )}
        </div>
        <span className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium tabular-nums text-muted">{total.toLocaleString('ru-RU')} mijoz</span>
      </div>

      <div className="min-h-[15rem] space-y-2.5">
        {loading ? (
          Array.from({ length: PAGE_SIZE }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)
        ) : error ? (
          <div className="grid h-56 place-items-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-500">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
              </div>
              <div className="text-sm font-medium">Ro‘yxatni yuklab bo‘lmadi</div>
              <div className="max-w-xs text-xs text-muted">{error}</div>
              <button onClick={() => load()} className="btn-ghost mt-1 text-xs">Qayta urinish</button>
            </div>
          </div>
        ) : persons.length === 0 ? (
          <div className="grid h-56 place-items-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <div className="text-sm font-medium">{q ? `«${q}» topilmadi` : 'Bu bosqichda mijoz yo‘q'}</div>
              <div className="max-w-xs text-xs text-muted">
                {q ? 'Boshqa ism, kod yoki PINFL bilan qidirib ko‘ring.' : phaseLabel ? `«${phaseLabel}» bosqichiga hali ariza yetib kelmagan.` : 'Bu firma/snapshot bo‘yicha mijoz yo‘q.'}
              </div>
              {q && <button onClick={() => setQ('')} className="btn-ghost mt-1 text-xs">Qidiruvni tozalash</button>}
            </div>
          </div>
        ) : (
          persons.map((p) => <PersonCard key={p.pinfl} p={p} />)
        )}
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">
            <Ico.chevronLeft size={14} /> Oldingi
          </button>
          <span className="text-xs tabular-nums text-muted">{page} / {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages || loading} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">
            Keyingi <span className="inline-block rotate-180"><Ico.chevronLeft size={14} /></span>
          </button>
        </div>
      )}
    </div>
  );
}
