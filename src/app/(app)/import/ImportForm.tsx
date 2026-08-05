'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { DateField, Ico } from '@/ui';

const KB = 1024;
const fileSize = (b: number) =>
  b < KB * KB ? `${Math.round(b / KB)} KB` : `${(b / KB / KB).toFixed(1)} MB`;

type Phase = 'idle' | 'uploading' | 'running' | 'done' | 'failed';

interface JobStatus {
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  progress: number;
  total: number;
  message: string | null;
}

/**
 * Single-file picker for the portfolio xlsx. The shared `FilePicker` in `@/ui` enforces a 10 MB
 * cap and multi-file attachment semantics meant for ariza documents — the portfolio file is a
 * single spreadsheet that regularly runs well past 100 MB, so this form uses a plain file input
 * instead of forcing that component to fit.
 */
export function ImportForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function onFileChosen(picked: FileList | null) {
    const f = picked?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setPhase('idle');

    try {
      const res = await fetch('/api/import/peek', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: f.name }),
      });
      if (!res.ok) return;
      const { date: parts } = await res.json();
      if (parts) {
        const year = parts.year ?? new Date().getFullYear();
        const iso = `${year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
        setDate(iso);
      }
    } catch {
      // Peek is only a prefill convenience — leave the date field for manual entry on failure.
    }
  }

  function poll(jobId: number) {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const job: JobStatus = await res.json();
        setProgress(job.progress);
        setTotal(job.total);
        if (job.status === 'DONE') {
          clearInterval(timer);
          setPhase('done');
        } else if (job.status === 'FAILED') {
          clearInterval(timer);
          setError(job.message ?? 'Import muvaffaqiyatsiz tugadi');
          setPhase('failed');
        }
      } catch {
        // transient network hiccup — keep polling on the next tick
      }
    }, 1000);
  }

  async function onUpload() {
    if (!file || !date) return;
    setPhase('uploading');
    setError(null);
    setProgress(0);
    setTotal(0);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('date', date);
      const res = await fetch('/api/import', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Yuklashda xatolik');
        setPhase('failed');
        return;
      }
      const { jobId } = await res.json();
      setPhase('running');
      poll(jobId);
    } catch {
      setError('Yuklashda xatolik');
      setPhase('failed');
    }
  }

  const busy = phase === 'uploading' || phase === 'running';
  const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;

  return (
    <div className="card max-w-xl space-y-5 p-6">
      <div>
        <span className="field-label">Portfel fayli (.xlsx)</span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={busy}
          onChange={(e) => onFileChosen(e.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="btn-ghost w-full justify-center py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Ico.add size={16} /> Fayl tanlash
        </button>

        {file && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line p-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-surface-2 text-[10px] font-bold uppercase text-muted">
              xlsx
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{file.name}</span>
              <span className="block text-[11px] text-muted">{fileSize(file.size)}</span>
            </span>
          </div>
        )}
      </div>

      <DateField
        label="Hisobot sanasi"
        value={date}
        onChange={setDate}
        disabled={busy}
        hint="Fayl nomidan avtomatik aniqlanadi — kerak boʻlsa tahrirlang"
      />

      <button
        type="button"
        onClick={onUpload}
        disabled={!file || !date || busy}
        className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase === 'uploading' ? 'Yuklanmoqda...' : 'Yuklash'}
      </button>

      {phase === 'running' && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Bajarilyapti… {progress}{total > 0 ? `/${total}` : ''}
          </p>
        </div>
      )}

      {phase === 'done' && (
        <div className="rounded-xl border border-accent-500/30 bg-accent-500/10 p-3">
          <p className="text-sm font-medium text-accent-700 dark:text-accent-400">
            Tayyor — {progress} ta qator yuklandi
          </p>
          <Link href={`/s/${date}`} className="mt-1 inline-block text-sm font-medium underline">
            Hisobotni koʻrish
          </Link>
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
