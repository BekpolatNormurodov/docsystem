'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentDownload, TickCircle, SearchNormal1 } from 'iconsax-react';
import { Modal } from '@/ui';

interface FirmChip {
  code: string;
  name: string;
  count: number;
}

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'failed';
interface JobStatus {
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  progress: number;
  total: number;
  message: string | null;
}

/** Groups digits with thin spaces: "1000000" → "1 000 000". */
const money = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function FilterExportBar({
  date,
  firms,
  initial,
  matchClients,
  matchContracts,
}: {
  date: string;
  firms: FirmChip[];
  initial: { q: string; branches: string[]; minDebt: string; onlyExcluded: boolean };
  matchClients: number;
  matchContracts: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [minDebt, setMinDebt] = useState(initial.minDebt); // digits only
  const onlyExcluded = initial.onlyExcluded;
  // All firms checked by default; an explicit URL branch list narrows it.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initial.branches.length ? initial.branches : firms.map((f) => f.code)),
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);

  const allChecked = checked.size === firms.length;
  const none = checked.size === 0;

  function toggle(code: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }
  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(firms.map((f) => f.code)));
  }

  function buildUrl(ex: boolean) {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (minDebt) p.set('minDebt', minDebt);
    if (!allChecked) [...checked].forEach((c) => p.append('branch', c));
    if (ex) p.set('ex', '1');
    p.set('page', '1');
    return `/hujjatlar/${date}?${p.toString()}`;
  }
  function setMode(ex: boolean) {
    router.push(buildUrl(ex));
  }

  // Real-time filtering: any change to search / firms / debt re-queries after a short debounce
  // (replace, not push, so typing doesn't flood the history). No «Filtrlash» button needed.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => router.replace(buildUrl(onlyExcluded)), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, minDebt, checked]);

  function poll(id: number) {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/export/${id}`);
        if (!res.ok) return;
        const job: JobStatus = await res.json();
        setProgress(job.progress);
        setTotal(job.total);
        if (job.status === 'DONE') {
          clearInterval(timer);
          setPhase('done');
        } else if (job.status === 'FAILED') {
          clearInterval(timer);
          setError(job.message ?? 'Eksport muvaffaqiyatsiz tugadi');
          setPhase('failed');
        }
      } catch {
        /* keep polling */
      }
    }, 1000);
  }

  async function startExport() {
    setPhase('starting');
    setError(null);
    setProgress(0);
    setTotal(0);
    setJobId(null);
    try {
      const branches = allChecked ? undefined : [...checked];
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, branches, q: q.trim() || undefined, minDebt: minDebt ? Number(minDebt) : undefined, onlyExcluded }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? 'Boshlashda xatolik');
        setPhase('failed');
        return;
      }
      const { jobId: id, total: t } = await res.json();
      setJobId(id);
      setTotal(t);
      if (t === 0) {
        setError('Bu filtr boʻyicha ariza topilmadi');
        setPhase('failed');
        return;
      }
      setPhase('running');
      poll(id);
    } catch {
      setError('Boshlashda xatolik');
      setPhase('failed');
    }
  }

  function openModal() {
    // Don't wipe a running/finished job when reopening — only reset for a fresh confirm.
    if (phase !== 'running' && phase !== 'starting') {
      setPhase('idle');
      setError(null);
    }
    setModalOpen(true);
  }

  const busy = phase === 'starting' || phase === 'running';
  const pct = total > 0 ? Math.min(99, Math.round((progress / total) * 100)) : 0;
  const selectedNames = allChecked ? 'Barcha firmalar' : firms.filter((f) => checked.has(f.code)).map((f) => f.name).join(', ');

  return (
    <div className="card mb-5 space-y-4 p-5">
      {/* Mode: everyone vs only the court-list (2nd-excel) clients. */}
      <div className="inline-flex rounded-xl border border-line bg-surface-2 p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => setMode(false)}
          className={`rounded-lg px-4 py-1.5 transition ${!onlyExcluded ? 'bg-brand-600 text-white shadow' : 'text-muted hover:text-fg'}`}
        >
          Barchasi
        </button>
        <button
          type="button"
          onClick={() => setMode(true)}
          className={`rounded-lg px-4 py-1.5 transition ${onlyExcluded ? 'bg-amber-600 text-white shadow' : 'text-muted hover:text-fg'}`}
        >
          Sud roʻyxati
        </button>
      </div>

      {/* Firm selection — pill checkboxes, all ticked by default. */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="field-label mb-0">Firmalar</span>
          <button type="button" onClick={toggleAll} className="text-xs font-medium text-brand-600 hover:underline">
            {allChecked ? 'Hammasini olib tashlash' : 'Hammasini tanlash'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {firms.map((f) => {
            const on = checked.has(f.code);
            return (
              <label
                key={f.code}
                className={`flex cursor-pointer select-none items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                  on ? 'border-brand-500/60 bg-brand-500/10 text-fg' : 'border-line text-muted hover:bg-surface-2'
                }`}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(f.code)} className="h-3.5 w-3.5 accent-brand-600" />
                <span className="font-medium">{f.name}</span>
                <span className="opacity-60">{f.count.toLocaleString('ru-RU')}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="field-label">Qidiruv (F.I.Sh, PINFL, shartnoma)</span>
          <div className="relative">
            <SearchNormal1 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="field-input w-full pl-9"
              placeholder="masalan: ABDULLAYEV yoki 3210…"
            />
          </div>
        </label>
        <label className="w-52">
          <span className="field-label">Qarz ≥ (mijoz jami)</span>
          <div className="relative">
            <input
              value={money(minDebt)}
              onChange={(e) => setMinDebt(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              className="field-input w-full pr-12 text-right"
              placeholder="0"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">soʻm</span>
          </div>
        </label>
        <button type="button" onClick={openModal} disabled={none} className="btn-primary disabled:opacity-50">
          <DocumentDownload size={16} /> ZIP yaratish
        </button>
      </div>

      {/* Persistent status — the job runs server-side, so this stays even if the modal is closed. */}
      {(phase === 'running' || phase === 'starting' || phase === 'done' || phase === 'failed') && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm">
          {(phase === 'running' || phase === 'starting') && (
            <>
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
              <span className="font-medium">
                Eksport orqada ketyapti… {pct}% ({progress.toLocaleString('ru-RU')}/{total.toLocaleString('ru-RU')})
              </span>
              <span className="text-xs text-muted">Modalni yopsangiz ham davom etadi.</span>
            </>
          )}
          {phase === 'done' && jobId !== null && (
            <>
              <span className="font-medium text-accent-700 dark:text-accent-400">
                Tayyor — {progress.toLocaleString('ru-RU')} ta ariza.
              </span>
              <a href={`/api/export/${jobId}/download`} className="btn-primary py-1.5 text-xs">
                <DocumentDownload size={14} /> ZIP yuklab olish
              </a>
            </>
          )}
          {phase === 'failed' && error && <span className="font-medium text-rose-600 dark:text-rose-300">{error}</span>}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Arizalarni ZIP qilish"
        description="Tanlangan filtr boʻyicha har bir shartnoma uchun .docx ariza yaratiladi."
        footer={
          phase === 'done' && jobId !== null ? (
            <a href={`/api/export/${jobId}/download`} className="btn-primary">
              <DocumentDownload size={16} /> ZIP yuklab olish
            </a>
          ) : phase === 'idle' || phase === 'failed' ? (
            <>
              <button type="button" onClick={() => setModalOpen(false)} className="btn-ghost">
                Bekor
              </button>
              <button type="button" onClick={startExport} className="btn-primary">
                <TickCircle size={16} /> Yaratish
              </button>
            </>
          ) : null
        }
      >
        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted">Firmalar</span>
            <span className="text-right font-medium">{selectedNames}</span>
          </div>
          {q.trim() && (
            <div className="flex justify-between gap-4">
              <span className="text-muted">Qidiruv</span>
              <span className="font-medium">{q.trim()}</span>
            </div>
          )}
          {minDebt && (
            <div className="flex justify-between gap-4">
              <span className="text-muted">Qarz ≥</span>
              <span className="font-medium">{money(minDebt)} soʻm</span>
            </div>
          )}
          {phase === 'idle' && (
            <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
              Joriy filtr boʻyicha: {matchClients.toLocaleString('ru-RU')} mijoz · {matchContracts.toLocaleString('ru-RU')} shartnoma.
              «Yaratish»ni bosing.
            </p>
          )}
          {busy && (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 font-medium">
                Yaratilmoqda… {progress.toLocaleString('ru-RU')}/{total.toLocaleString('ru-RU')} ({pct}%)
              </p>
            </div>
          )}
          {phase === 'done' && (
            <p className="font-medium text-accent-700 dark:text-accent-400">
              Tayyor — {progress.toLocaleString('ru-RU')} ta ariza. Pastdan yuklab oling.
            </p>
          )}
          {phase === 'failed' && error && <p className="font-medium text-rose-600 dark:text-rose-300">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
