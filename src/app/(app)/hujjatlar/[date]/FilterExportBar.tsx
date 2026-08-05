'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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

/** Client filter + export bar: chips/search push to the URL (re-rendering the cards) and drive the ZIP. */
export function FilterExportBar({
  date,
  firms,
  initial,
}: {
  date: string;
  firms: FirmChip[];
  initial: { q: string; branches: string[]; minDebt: string };
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [minDebt, setMinDebt] = useState(initial.minDebt);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial.branches));

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);

  const allSelected = selected.size === 0 || selected.size === firms.length;
  const busy = phase === 'starting' || phase === 'running';

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function apply() {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (minDebt) p.set('minDebt', minDebt);
    if (!allSelected) [...selected].forEach((c) => p.append('branch', c));
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

  async function exportZip() {
    setPhase('starting');
    setError(null);
    setProgress(0);
    setTotal(0);
    setJobId(null);
    try {
      const branches = allSelected ? undefined : [...selected];
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

  const pct = total > 0 ? Math.min(99, Math.round((progress / total) * 100)) : 0;

  return (
    <div className="card mb-5 space-y-4 p-5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            allSelected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface hover:bg-surface-2'
          }`}
        >
          Barcha firmalar
        </button>
        {firms.map((f) => {
          const on = !allSelected && selected.has(f.code);
          return (
            <button
              key={f.code}
              type="button"
              onClick={() => toggle(f.code)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface hover:bg-surface-2'
              }`}
            >
              {f.name} <span className="opacity-70">· {f.count.toLocaleString('ru-RU')}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="field-label">Qidiruv (F.I.Sh, PINFL, shartnoma)</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            className="field-input w-full"
            placeholder="masalan: ABDULLAYEV yoki 3210…"
          />
        </label>
        <label className="w-40">
          <span className="field-label">Qarz ≥</span>
          <input
            value={minDebt}
            onChange={(e) => setMinDebt(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            className="field-input w-full"
          />
        </label>
        <button type="button" onClick={apply} className="btn-ghost">
          Filtrlash
        </button>
        <button type="button" onClick={exportZip} disabled={busy} className="btn-primary disabled:opacity-50">
          {phase === 'starting' ? 'Boshlanmoqda…' : phase === 'running' ? 'Yaratilmoqda…' : 'ZIP yaratish'}
        </button>
      </div>

      {phase === 'running' && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm font-medium">
            Arizalar yaratilmoqda… {progress.toLocaleString('ru-RU')}/{total.toLocaleString('ru-RU')} ({pct}%)
          </p>
        </div>
      )}
      {phase === 'done' && jobId !== null && (
        <div className="rounded-xl border border-accent-500/30 bg-accent-500/10 p-3">
          <p className="text-sm font-medium text-accent-700 dark:text-accent-400">Tayyor — {progress.toLocaleString('ru-RU')} ta ariza</p>
          <a href={`/api/export/${jobId}/download`} className="mt-1 inline-block text-sm font-medium underline">
            ZIP yuklab olish
          </a>
        </div>
      )}
      {phase === 'failed' && error && (
        <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
