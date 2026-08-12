'use client';

import React, { useEffect, useRef, useState } from 'react';

interface JobState { status: string; progress: number; total: number; message?: string | null }

// «Tayyorlash»: kicks off a BACKGROUND job that builds the full packet (Talabnoma
// xlsx+pdf, Ariza, Grafik, Invoice, firma docs) for EVERY case in scope into one
// ZIP — not case-by-case. Polls the job and offers the download when ready.
export function PacketBulk({ firmId, snapshotId, stages, scopeLabel }: {
  firmId?: number; snapshotId?: number; stages: string[]; scopeLabel: string;
}) {
  const [withPdf, setWithPdf] = useState(true);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Synchronous guard: two fast clicks land before React flushes `starting` to the
  // disabled attr, so a state flag alone would let both POST and spawn two jobs/ZIPs.
  const inFlight = useRef(false);

  // Reset when the scope changes so a stale job/result isn't misattributed.
  useEffect(() => { setJobId(null); setJob(null); setErr(null); }, [firmId, snapshotId, stages.join(',')]);

  // Poll the job while it runs.
  useEffect(() => {
    if (jobId == null) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok || !alive) return;
        const s: JobState = await res.json();
        if (!alive) return;
        setJob(s);
        if (s.status === 'DONE' || s.status === 'FAILED') {
          if (timer.current) clearInterval(timer.current);
          if (s.status === 'FAILED') setErr(s.message || 'Xatolik');
        }
      } catch { /* transient poll error — keep polling */ }
    };
    tick();
    timer.current = setInterval(tick, 2000);
    return () => { alive = false; if (timer.current) clearInterval(timer.current); };
  }, [jobId]);

  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true); setErr(null); setJob(null); setJobId(null);
    try {
      const res = await fetch('/konveyer/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, firmId, stages, talabnomaPdf: withPdf }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error || 'Xatolik'); return; }
      setJob({ status: 'PENDING', progress: 0, total: data.total });
      setJobId(data.jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Tarmoq xatosi');
    } finally { setStarting(false); inFlight.current = false; }
  };

  const running = jobId != null && (job?.status === 'PENDING' || job?.status === 'RUNNING' || (!job && !err));
  const done = job?.status === 'DONE';
  const pct = job && job.total ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!running && !done && (
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-brand-500/30" title="Talabnoma PDF ham qo'shiladi (sekinroq)">
          <input type="checkbox" checked={withPdf} onChange={(e) => setWithPdf(e.target.checked)} className="h-3 w-3 accent-brand-500" />
          Talabnoma PDF
        </label>
      )}

      {!done ? (
        <button
          onClick={start}
          disabled={!!running || starting}
          aria-busy={!!running || starting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-all hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-wait disabled:opacity-70"
          title={`«${scopeLabel}» bo'yicha hammasini tayyorlash (orqada)`}
        >
          {running
            ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Tayyorlanmoqda… {job?.progress ?? 0}/{job?.total ?? ''}</>
            : <><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /></svg> Tayyorlash</>}
        </button>
      ) : (
        <a
          href={`/api/export/${jobId}/download`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 outline-none transition-colors hover:bg-emerald-500/15 focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-300"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /></svg>
          {job?.total ?? ''} ta paket tayyor — yuklab olish
        </a>
      )}

      {running && job && job.total > 0 && (
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span className="block h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </span>
      )}
      {err && <span role="alert" className="text-[11px] font-medium text-rose-500">{err}</span>}
    </div>
  );
}
