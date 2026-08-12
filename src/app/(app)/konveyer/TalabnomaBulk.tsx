'use client';

import React, { useEffect, useRef, useState } from 'react';

interface JobState { status: string; progress: number; total: number; message?: string | null }

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

// Stream a POST response body to a browser download, honouring the server's Content-Disposition
// filename (falls back to `fallback`). Shared by the Excel button.
async function downloadFromResponse(res: Response, fallback: string) {
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m ? decodeURIComponent(m[1]) : fallback;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/**
 * Talabnoma step's two bulk exports for ONE firm × the selected snapshot:
 *  · «Reyestr (Excel)» — instant .xlsx, one row per client (the hippo import file).
 *  · «Talabnoma PDF» — a background job → ZIP of one letter per client (+ the reyestr at the root).
 * Both are per-firm because a xat.hippo reyestr is uploaded per firm; with «Hamma firma» selected
 * the panel asks the operator to pick a firm first.
 */
export function TalabnomaBulk({ firmId, firmName, snapshotId, scopeLabel, firms = [], onSelectFirm }: {
  firmId?: number; firmName?: string; snapshotId?: number; scopeLabel: string;
  firms?: { firmId: number; firmName: string; total: number }[];
  onSelectFirm?: (id: number) => void;
}) {
  const n = (x: number) => x.toLocaleString('ru-RU');
  // Excel (synchronous) state.
  const [xlsBusy, setXlsBusy] = useState(false);
  const [xlsErr, setXlsErr] = useState<string | null>(null);

  // PDF (background job) state — mirrors PacketBulk.
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);
  const xlsInFlight = useRef(false); // sync guard: two fast clicks race the async xlsBusy flag

  const needFirm = firmId == null || snapshotId == null;

  // Reset when the scope changes so a stale job/result isn't misattributed.
  useEffect(() => { setJobId(null); setJob(null); setErr(null); setXlsErr(null); }, [firmId, snapshotId]);

  // Poll the PDF job while it runs.
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

  const downloadExcel = async () => {
    if (needFirm || xlsInFlight.current) return;
    xlsInFlight.current = true;
    setXlsBusy(true); setXlsErr(null);
    try {
      const res = await fetch('/konveyer/talabnoma-bulk-excel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, firmId }),
      });
      if (!res.ok) { let e = 'Excel yaratilmadi'; try { e = (await res.json()).error || e; } catch {} throw new Error(e); }
      await downloadFromResponse(res, 'Talabnoma_reyestr.xlsx');
    } catch (e) { setXlsErr(e instanceof Error ? e.message : 'Excel yaratilmadi'); }
    finally { setXlsBusy(false); xlsInFlight.current = false; }
  };

  const startPdf = async () => {
    if (needFirm || inFlight.current) return;
    inFlight.current = true;
    setStarting(true); setErr(null); setJob(null); setJobId(null);
    try {
      const res = await fetch('/konveyer/talabnoma-bulk-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, firmId }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error || 'Xatolik'); return; }
      setJob({ status: 'PENDING', progress: 0, total: data.total });
      setJobId(data.jobId);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Tarmoq xatosi'); }
    finally { setStarting(false); inFlight.current = false; }
  };

  const running = jobId != null && (job?.status === 'PENDING' || job?.status === 'RUNNING' || (!job && !err));
  const done = job?.status === 'DONE';
  const pct = job && job.total ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0;
  // On DONE: progress = PDFs actually rendered (made), total = clients expected. A shortfall means
  // some talabnoma didn't render — surfaced in red, though the partial ZIP is still downloadable.
  const made = job?.progress ?? 0;
  const expected = job?.total ?? 0;
  const short = done && expected > 0 && made < expected;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Talabnoma tayyorlash</div>
          <div className="mt-0.5 text-xs text-muted">Reyestr (Excel) va har mijozga talabnoma PDF · {scopeLabel}</div>
        </div>
      </div>

      {needFirm ? (
        <div className="space-y-2.5">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
            Talabnoma reyestri firma boʻyicha tayyorlanadi (har firma xat.hippo ga alohida yuklanadi). Firmani tanlang:
          </div>
          {firms.length > 0 && onSelectFirm && (
            <div className="flex flex-wrap gap-1.5">
              {firms.map((f) => (
                <button
                  key={f.firmId}
                  onClick={() => onSelectFirm(f.firmId)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium outline-none transition-colors hover:border-brand-500/50 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30"
                  title={`«${f.firmName}» boʻyicha talabnoma tayyorlash`}
                >
                  <span className="max-w-[14rem] truncate">{f.firmName}</span>
                  <span className="tabular-nums text-[11px] text-muted">{n(f.total)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* Reyestr (Excel) — instant, one row per client. */}
          <button
            onClick={downloadExcel}
            disabled={xlsBusy}
            aria-busy={xlsBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg outline-none transition-colors hover:border-brand-500/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-wait disabled:opacity-60"
            title={`«${firmName ?? 'firma'}» reyestrini Excel qilib olish`}
          >
            {xlsBusy
              ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> Tayyorlanmoqda…</>
              : <><svg className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 3v18M3 8h5M3 13h5M3 18h5" /></svg> Reyestr (Excel)</>}
          </button>

          {/* Talabnoma PDF — background job → ZIP of one letter per client. */}
          {!done ? (
            <button
              onClick={startPdf}
              disabled={!!running || starting}
              aria-busy={!!running || starting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-all hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-wait disabled:opacity-70"
              title={`«${firmName ?? 'firma'}» har mijoziga talabnoma PDF (orqada)`}
            >
              {running
                ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Tayyorlanmoqda… {job?.progress ?? 0}/{job?.total ?? ''}</>
                : <><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg> Talabnoma PDF</>}
            </button>
          ) : (
            <>
              <a
                href={`/api/export/${jobId}/download`}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2',
                  short
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 focus-visible:ring-rose-500/40 dark:text-rose-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 focus-visible:ring-emerald-500/40 dark:text-emerald-300',
                )}
                title={short ? `${n(expected - made)} ta talabnoma yuklanmadi — qolgani ZIP ichida` : undefined}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /></svg>
                {n(made)} ta talabnoma tayyor — yuklab olish
              </a>
              {short && (
                <span role="alert" className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                  ⚠ {n(expected - made)} ta yuklanmadi ({n(made)}/{n(expected)})
                </span>
              )}
            </>
          )}

          {running && job && job.total > 0 && (
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
            </span>
          )}
          {(err || xlsErr) && <span role="alert" className="text-[11px] font-medium text-rose-500">{xlsErr || err}</span>}
        </div>
      )}
    </div>
  );
}
