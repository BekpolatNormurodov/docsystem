'use client';

import { useState } from 'react';
import { Select, TextField } from '@/ui';

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'failed';

interface JobStatus {
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  progress: number;
  total: number;
  message: string | null;
  resultPath: string | null;
}

/** Filtered bulk ariza .docx export — same filters as the loan browse table, reused server-side. */
export function ExportForm({
  dates,
  firms,
}: {
  dates: string[];
  firms: { code: string; shortName: string }[];
}) {
  const [date, setDate] = useState(dates[0] ?? '');
  const [branch, setBranch] = useState('');
  const [q, setQ] = useState('');
  const [minDebt, setMinDebt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);

  const dateOptions = dates.map((d) => ({ value: d, label: d }));
  const firmOptions = [
    { value: '', label: 'Barcha firmalar' },
    ...firms.map((f) => ({ value: f.code, label: f.shortName })),
  ];

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
        // transient network hiccup — keep polling on the next tick
      }
    }, 1000);
  }

  async function onStart() {
    if (!date) return;
    setPhase('starting');
    setError(null);
    setProgress(0);
    setTotal(0);
    setJobId(null);

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          branch: branch || undefined,
          q: q || undefined,
          minDebt: minDebt ? Number(minDebt) : undefined,
        }),
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
      setPhase('running');
      poll(id);
    } catch {
      setError('Boshlashda xatolik');
      setPhase('failed');
    }
  }

  const busy = phase === 'starting' || phase === 'running';
  const pct = total > 0 ? Math.min(99, Math.round((progress / total) * 100)) : 0;

  return (
    <div className="card max-w-xl space-y-5 p-6">
      <Select
        label="Hisobot sanasi"
        value={date}
        onChange={setDate}
        options={dateOptions}
        placeholder="Sanani tanlang"
      />

      <Select
        label="Firma"
        value={branch}
        onChange={setBranch}
        options={firmOptions}
        placeholder="Barcha firmalar"
      />

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
        disabled={!date || busy}
        className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase === 'starting' ? 'Boshlanmoqda…' : phase === 'running' ? 'Yaratilmoqda…' : 'ZIP yaratish'}
      </button>

      {phase === 'running' && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-sm font-medium">
            Yaratilmoqda… {progress}/{total || '?'}
          </p>
        </div>
      )}

      {phase === 'done' && jobId !== null && (
        <div className="rounded-xl border border-accent-500/30 bg-accent-500/10 p-3">
          <p className="text-sm font-medium text-accent-700 dark:text-accent-400">
            Tayyor — {progress} ta hujjat
          </p>
          <a href={`/api/export/${jobId}/download`} className="mt-1 inline-block text-sm font-medium underline">
            Yuklab olish
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
