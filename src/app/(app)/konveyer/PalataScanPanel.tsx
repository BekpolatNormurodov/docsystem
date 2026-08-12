'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface FirmStat { firm: string; total: number; matched: number; withCase: number }
interface ScanRow { reg: string; name: string; pinfl: string; firm: string; address: string; hasCase: boolean; hasPortfolio: boolean; hasScan: boolean }
interface Summary { total: number; matched: number; withCase: number; noCase: number; firms: FirmStat[]; arizas: ScanRow[]; updatedAt: string | null }
interface OcrJob { id: number; status: string; progress: number; total: number; message: string | null }

const n = (x: number) => x.toLocaleString('ru-RU');

// «Palatadan kelgan» — imzolangan arizalar skanini yuklang; server OCR qilib firma +
// PINFL + F.I.O ajratadi, pipeline'da case bor/yo'qligini ko'rsatadi (real raqamlar).
export function PalataScanPanel() {
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [onlyNoCase, setOnlyNoCase] = useState(false);
  const [firmFilter, setFirmFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);        // uploading
  const [job, setJob] = useState<OcrJob | null>(null); // live OCR job
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/konveyer/palata-scan', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      setS(await res.json());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); }
    finally { setLoading(false); }
  }, []);

  // Poll the OCR job; on DONE reload the summary, on FAILED surface the message.
  const poll = useCallback(async () => {
    try {
      const res = await fetch('/konveyer/palata-ocr', { cache: 'no-store' });
      const d = await res.json();
      const j: OcrJob | null = d.job;
      setJob(j && (j.status === 'RUNNING' || j.status === 'PENDING') ? j : null);
      if (j && (j.status === 'RUNNING' || j.status === 'PENDING')) {
        pollRef.current = setTimeout(poll, 1500);
      } else if (j && j.status === 'DONE') {
        await loadSummary();
      } else if (j && j.status === 'FAILED') {
        setErr(j.message || 'OCR xatosi');
      }
    } catch { /* transient — stop polling silently */ }
  }, [loadSummary]);

  useEffect(() => {
    loadSummary();
    poll(); // resume if an OCR job is already running from before
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [loadSummary, poll]);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      Array.from(list).forEach((f) => fd.append('files', f));
      const res = await fetch('/konveyer/palata-ocr', { method: 'POST', body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error || 'Yuklab boʻlmadi'); }
      setJob({ id: 0, status: 'PENDING', progress: 0, total: 0, message: null });
      poll();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Yuklab boʻlmadi');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
      setBusy(false);
    }
  };

  const running = !!job && (job.status === 'RUNNING' || job.status === 'PENDING');
  const pct = job && job.total > 0 ? Math.round((job.progress / job.total) * 100) : null;

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M8 2v4M16 2v4M4 10h16" /></svg>
        </span>
        <div className="text-sm font-semibold">Palatadan kelgan (imzolangan skan)</div>
      </div>
      <div className="mb-4 text-xs text-muted">Skanerlangan arizalarni yuklang — server OCR qilib firma, PINFL va F.I.O ni ajratadi, pipeline holatini koʻrsatadi.</div>

      {/* Upload / OCR dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-busy={busy || running}
        onClick={() => !busy && !running && fileRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy && !running) { e.preventDefault(); fileRef.current?.click(); } }}
        className="mb-3 flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-violet-500/30 bg-violet-500/[0.04] px-4 py-5 text-center outline-none transition-colors hover:border-violet-500/50 focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/30 aria-busy:cursor-wait"
      >
        {busy || running
          ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
          : <svg className="h-6 w-6 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></svg>}
        <div className="text-sm font-medium">
          {busy ? 'Yuklanmoqda…' : running ? `OCR ishlayapti${pct != null ? ` · ${pct}%` : '…'}` : 'Skanerlangan PDF(lar)ni yuklang'}
        </div>
        <div className="text-[11px] text-muted">
          {running && job!.total > 0 ? `${n(job!.progress)} / ${n(job!.total)} sahifa` : 'bosing yoki tashlang · PDF · bir nechta'}
        </div>
        {running && pct != null && (
          <div className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-violet-500/15">
            <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        <input ref={fileRef} type="file" multiple accept=".pdf,application/pdf" className="hidden" onChange={onFiles} />
      </div>

      {err && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-rose-500">
          <span>{err}</span>
          <button onClick={() => { setErr(null); setLoading(true); loadSummary(); }} className="shrink-0 rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">Qayta urinish</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />)}</div>
      ) : !s || s.total === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-3 py-4 text-center text-[13px] text-muted">Hali skan oʻqilmagan. Yuqoridan PDF yuklang.</div>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-surface-2/60 p-2.5 text-center" title="Palatadan imzolangan boʻlib qaytgan, OCR oʻqigan arizalar soni">
              <div className="text-[11px] text-muted">Kelgan skan</div>
              <div className="text-xl font-semibold tabular-nums">{n(s.total)}</div>
            </div>
            <div className="rounded-lg bg-surface-2/60 p-2.5 text-center" title="Shu arizalardan konveyerda «ish» (ArizaCase) ochilganlari">
              <div className="text-[11px] text-muted">Ishda bor</div>
              <div className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{n(s.withCase)}</div>
            </div>
            <div className="rounded-lg bg-surface-2/60 p-2.5 text-center" title="Skani keldi, lekin konveyerda hali ish ochilmagan (eʼtibor talab)">
              <div className="text-[11px] text-muted">Ishda yoʻq</div>
              <div className="text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{n(s.noCase)}</div>
            </div>
          </div>
          <div className="mb-4 text-[11px] leading-relaxed text-muted">
            <b className="font-medium text-fg">{n(s.total)}</b> ta imzolangan ariza palatadan qaytdi va oʻqildi. Ulardan <b className="font-medium text-emerald-600 dark:text-emerald-400">{n(s.withCase)}</b> tasi konveyerda ish sifatida bor, <b className="font-medium text-amber-600 dark:text-amber-400">{n(s.noCase)}</b> tasi hali yoʻq.
          </div>
          <div className="space-y-1.5">
            {s.firms.map((f) => {
              const active = firmFilter === f.firm;
              return (
                <button
                  key={f.firm}
                  type="button"
                  onClick={() => { setFirmFilter(active ? null : f.firm); setOpen(true); setOnlyNoCase(false); }}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${active ? 'border-violet-500/50 bg-violet-500/[0.06]' : 'border-line bg-surface hover:bg-surface-2/60'}`}
                >
                  <span className="flex-1 truncate text-[13px] font-medium" title={f.firm}>{f.firm}</span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums">{n(f.total)} ta</span>
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-300" title="pipeline'da case bori">{n(f.withCase)} case</span>
                  {f.total - f.withCase > 0 && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber-700 dark:text-amber-300" title="case yoʻq (masalan sud roʻyxatida emas)">{n(f.total - f.withCase)} yoʻq</span>
                  )}
                </button>
              );
            })}
          </div>

          {s.arizas.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-violet-600 hover:underline dark:text-violet-400">
                  <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  {open ? 'Roʻyxatni yopish' : `Har birini koʻrish (${n(s.total)} ariza)`}
                </button>
                <a href="/konveyer/palata-scan-xlsx" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-emerald-700 hover:border-emerald-500/40 hover:bg-emerald-500/[0.06] dark:text-emerald-400" title="Butun roʻyxatni Excel qilib yuklab olish">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
                  Excel
                </a>
                {open && (
                  <>
                    {firmFilter && (
                      <button type="button" onClick={() => setFirmFilter(null)} className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                        {firmFilter} ✕
                      </button>
                    )}
                    <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                      <input type="checkbox" checked={onlyNoCase} onChange={(e) => setOnlyNoCase(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
                      faqat «ishda yoʻq»
                    </label>
                  </>
                )}
              </div>

              {open && (() => {
                const list = s.arizas.filter((a) => (!firmFilter || a.firm === firmFilter) && (!onlyNoCase || !a.hasCase));
                return (
                  <div className="mt-2 max-h-96 overflow-y-auto rounded-lg border border-line">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-surface-2 text-left text-[11px] text-muted">
                        <tr>
                          <th className="px-2.5 py-1.5 font-medium">#</th>
                          <th className="px-2.5 py-1.5 font-medium">Qarzdor</th>
                          <th className="px-2.5 py-1.5 font-medium">JShShIR</th>
                          <th className="px-2.5 py-1.5 font-medium">Firma</th>
                          <th className="px-2.5 py-1.5 font-medium">Holat</th>
                          <th className="px-2.5 py-1.5 font-medium text-center">Skan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((a, i) => (
                          <tr key={a.pinfl + a.reg} className={`border-t border-line/60 ${!a.hasCase ? 'bg-amber-500/[0.04]' : ''}`}>
                            <td className="px-2.5 py-1.5 tabular-nums text-muted">{i + 1}</td>
                            <td className="px-2.5 py-1.5">
                              <div className="font-medium">{a.name || <span className="text-muted">—</span>}</div>
                              {a.address && <div className="truncate text-[11px] text-muted" title={a.address}>{a.address}</div>}
                            </td>
                            <td className="px-2.5 py-1.5 font-mono tabular-nums text-[11px]">{a.pinfl}</td>
                            <td className="px-2.5 py-1.5 truncate" title={a.firm}>{a.firm}</td>
                            <td className="px-2.5 py-1.5">
                              {a.hasCase ? (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">case bor</span>
                              ) : a.hasPortfolio ? (
                                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">case yoʻq</span>
                              ) : (
                                <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">portfelda yoʻq</span>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5 text-center">
                              {a.hasScan ? (
                                <a href={`/konveyer/palata-scan-pdf?pinfl=${encodeURIComponent(a.pinfl)}`} title="Imzolangan skanni PDF yuklab olish" className="inline-flex text-violet-600 hover:text-violet-700 dark:text-violet-400">
                                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
                                </a>
                              ) : <span className="text-muted">—</span>}
                            </td>
                          </tr>
                        ))}
                        {list.length === 0 && (
                          <tr><td colSpan={6} className="px-2.5 py-4 text-center text-muted">Bunday ariza yoʻq.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
