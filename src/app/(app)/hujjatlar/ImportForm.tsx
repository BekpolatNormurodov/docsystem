'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { DateField, Ico } from '@/ui';
import { DocInfo, ReqChip, type DocInfoKind } from './DocInfo';

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

type Accent = 'brand' | 'amber';

const ACCENT: Record<Accent, { ring: string; icon: string; badge: string }> = {
  brand: {
    ring: 'hover:border-brand-500/60 hover:bg-brand-500/5',
    icon: 'bg-brand-500/10 text-brand-600 dark:text-brand-400',
    badge: 'bg-brand-500/10 text-brand-600 dark:text-brand-300',
  },
  amber: {
    ring: 'hover:border-amber-500/60 hover:bg-amber-500/5',
    icon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
};

/** A drag-and-drop file dropzone; shows the picked file as a card with a remove button. */
function Dropzone({
  label,
  hint,
  accent,
  file,
  disabled,
  onPick,
  onClear,
  info,
  required,
}: {
  label: string;
  hint: string;
  accent: Accent;
  file: File | null;
  disabled: boolean;
  onPick: (files: FileList | null) => void;
  onClear: () => void;
  info?: DocInfoKind;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const a = ACCENT[accent];

  return (
    <div className={required ? 'rounded-xl border border-emerald-500/25 bg-emerald-500/[0.03] p-3' : undefined}>
      <span className="field-label flex flex-wrap items-center gap-2">{label}{required !== undefined && <ReqChip required={required} />}{info && <DocInfo kind={info} />}</span>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => onPick(e.target.files)}
      />

      {file ? (
        <div className={`flex items-center gap-3 rounded-xl border border-line p-3 ${disabled ? 'opacity-60' : ''}`}>
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[11px] font-bold uppercase ${a.badge}`}>
            xlsx
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{file.name}</span>
            <span className="block text-xs text-muted">{fileSize(file.size)}</span>
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Olib tashlash"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-rose-500/10 hover:text-rose-500"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!disabled) onPick(e.dataTransfer.files);
          }}
          className={`flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
            drag ? 'border-brand-500 bg-brand-500/10' : `border-line ${a.ring}`
          }`}
        >
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${a.icon}`}>
            <Ico.add size={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Fayl tanlash yoki bu yerga tashlang</span>
            <span className="block truncate text-xs text-muted">{hint}</span>
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Two-file importer (portfolio + exclusion list). A plain file input is used instead of the shared
 * `FilePicker` (which caps at 10 MB) because the portfolio spreadsheet regularly runs past 100 MB.
 */
export function ImportForm({ children }: { children?: React.ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [excludeFile, setExcludeFile] = useState<File | null>(null);
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

  function onExcludeFileChosen(picked: FileList | null) {
    const f = picked?.[0];
    if (!f) return;
    setExcludeFile(f);
    setError(null);
  }

  async function onUpload() {
    if (!file || !date) return;
    setPhase('uploading');
    setError(null);
    setProgress(0);

    try {
      const form = new FormData();
      form.append('file', file);
      if (excludeFile) form.append('exclude', excludeFile); // sud ro'yxati — ixtiyoriy
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
  // Faqat Portfel + sana majburiy; sud (istisno) ro'yxati ixtiyoriy.
  const ready = !!file && !!date;
  // Capped at 99% mid-stream because `total` is an estimate; the DONE state shows completion.
  const pct = total > 0 ? Math.min(99, Math.round((progress / total) * 100)) : 0;

  return (
    <div className="card max-w-md space-y-4 p-6">
      <Dropzone
        label="Portfel fayli (.xlsx)"
        hint="Ensay portfeli — .xlsx (100 MB dan katta boʻlishi mumkin) · majburiy"
        accent="brand"
        file={file}
        disabled={busy}
        onPick={onFileChosen}
        onClear={() => setFile(null)}
        info="portfel"
        required
      />

      <Dropzone
        label="Muammoli / istisno roʻyxati — sud roʻyxati (.xlsx)"
        hint="«Pnfl» varagʻidagi mijozlar — ularga ariza yaratiladi · ixtiyoriy"
        accent="amber"
        file={excludeFile}
        disabled={busy}
        onPick={onExcludeFileChosen}
        onClear={() => setExcludeFile(null)}
        info="sud"
        required={false}
      />

      {/* 3-fayl: Talabnoma ro'yxati (.xlsx) — mustaqil app-doc dropzone, shu layoutda. */}
      {children}

      <div className="max-w-[220px]">
        <DateField
          label="Hisobot sanasi"
          value={date}
          onChange={setDate}
          disabled={busy}
          hint="Fayl nomidan avtomatik aniqlanadi — kerak boʻlsa tahrirlang"
        />
      </div>

      <button
        type="button"
        onClick={onUpload}
        disabled={!ready || busy}
        className="btn-primary w-full justify-center py-2.5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase === 'uploading' ? 'Fayl yuklanmoqda…' : phase === 'running' ? 'Saqlanmoqda…' : 'Yuklash'}
      </button>

      {phase === 'idle' && !ready && (
        <p className="text-center text-[11px] text-muted">Portfel fayli va sanani tanlang (sud roʻyxati ixtiyoriy).</p>
      )}

      {phase === 'uploading' && (
        <p className="text-xs text-muted">
          Fayl serverga yuklanmoqda{file ? ` (${fileSize(file.size)})` : ''}… bir oz kuting.
        </p>
      )}

      {phase === 'running' && (
        <div>
          {/* `total` is an estimate from file size, so we cap the bar at 99% until the stream truly
              finishes (DONE), then it snaps to 100% — never a false 100% mid-import. */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm font-medium">Ma'lumotlar saqlanyapti (orqa fonda)… {pct}%</p>
          <p className="mt-1 text-[11px] text-muted">
            {progress.toLocaleString('ru-RU')} qator saqlandi. Bir necha daqiqa oladi — sahifani
            yopsangiz ham import serverda davom etadi.
          </p>
        </div>
      )}

      {phase === 'done' && (
        <div className="rounded-xl border border-accent-500/30 bg-accent-500/10 p-3">
          <p className="text-sm font-medium text-accent-700 dark:text-accent-400">
            ✓ Tayyor — {progress.toLocaleString('ru-RU')} ta qator yuklandi
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
