'use client';

import { useState } from 'react';
import { TextField } from '@/ui';

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'failed';

interface JobStatus {
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  progress: number;
  total: number;
  message: string | null;
}

interface FirmChip {
  code: string;
  name: string;
  count: number;
}

/** Date-scoped bulk export: pick any subset of firms (chips), optionally filter, build a ZIP. */
export function ExportPanel({ date, firms }: { date: string; firms: FirmChip[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [minDebt, setMinDebt] = useState('');
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
  function selectAll() {
    setSelected(new Set());
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
        /* transient — keep polling */
      }
    }, 1000);
  }

  async function onStart() {
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
        body: JSON.stringify({ date, branches, q: q || undefined, minDebt: minDebt ? Number(minDebt) : undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Boshlashda xatolik');
        setPhase('failed');
        return;
      }
      const { jobId: id, total: t } = await res.json();
      setJobId(id);
      setTotal(t);
      if (t === 0) {
        setError('Tanlangan filtr boʻyicha ariza topilmadi');
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
    <div className="card max-w-2xl space-y-5 p-6">
      <div>
        <span className="field-label">Firmalar</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectAll}
            disabled={busy}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              allSelected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface hover:bg-surface-2'
            }`}
          >
            Barchasi
          </button>
          {firms.map((f) => {
            const on = !allSelected && selected.has(f.code);
            return (
              <button
                key={f.code}
                type="button"
                onClick={() => toggle(f.code)}
                disabled={busy}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface hover:bg-surface-2'
                }`}
              >
                {f.name} <span className="opacity-70">· {f.count.toLocaleString('ru-RU')}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {allSelected ? 'Barcha firmalar tanlangan' : `${selected.size} ta firma tanlangan`}
        </p>
      </div>

      <TextField label="Qidiruv (F.I.Sh, PINFL, shartnoma)" value={q} onChange={setQ} disabled={busy} />
      <TextField
        label="Qarz ≥"
        value={minDebt}
        onChange={setMinDebt}
        inputMode="numeric"
        disabled={busy}
        hint="Ixtiyoriy — minimal umumiy qarz summasi"
      />

      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase === 'starting' ? 'Boshlanmoqda…' : phase === 'running' ? 'Yaratilmoqda…' : 'ZIP yaratish'}
      </button>

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
