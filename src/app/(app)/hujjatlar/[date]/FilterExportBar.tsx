'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Filter, DocumentDownload, TickCircle, SearchNormal1 } from 'iconsax-react';
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
  initial: { q: string; branches: string[]; minDebt: string };
  matchClients: number;
  matchContracts: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [minDebt, setMinDebt] = useState(initial.minDebt); // digits only
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

  function apply() {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (minDebt) p.set('minDebt', minDebt);
    if (!allChecked) [...checked].forEach((c) => p.append('branch', c));
    p.set('page', '1');
    router.push(`/hujjatlar/${date}?${p.toString()}`);
  }

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
        body: JSON.stringify({ date, branches, q: q.trim() || undefined, minDebt: minDebt ? Number(minDebt) : undefined }),
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
    setPhase('idle');
    setError(null);
    setModalOpen(true);
  }

  const busy = phase === 'starting' || phase === 'running';
  const pct = total > 0 ? Math.min(99, Math.round((progress / total) * 100)) : 0;
  const selectedNames = allChecked ? 'Barcha firmalar' : firms.filter((f) => checked.has(f.code)).map((f) => f.name).join(', ');

  return (
    <div className="card mb-5 space-y-4 p-5">
      {/* Firm checkboxes — all ticked by default; untick to exclude. */}
      <div>
        <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 accent-brand-600" />
          Barcha firmalar
        </label>
        <div className="flex flex-wrap gap-x-5 gap-y-2 pl-1">
          {firms.map((f) => (
            <label key={f.code} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked.has(f.code)}
                onChange={() => toggle(f.code)}
                className="h-4 w-4 accent-brand-600"
              />
              {f.name}
              <span className="text-xs text-muted">· {f.count.toLocaleString('ru-RU')}</span>
            </label>
          ))}
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
              onKeyDown={(e) => e.key === 'Enter' && apply()}
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
        <button type="button" onClick={apply} className="btn-ghost">
          <Filter size={16} /> Filtrlash
        </button>
        <button type="button" onClick={openModal} disabled={none} className="btn-primary disabled:opacity-50">
          <DocumentDownload size={16} /> ZIP yaratish
        </button>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => !busy && setModalOpen(false)}
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
