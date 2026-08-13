'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico } from '@/ui';

interface JobState { status: string; progress: number; total: number; message?: string | null }
interface Sum { count: number; sent: number; remaining: number; totalDebt: number; remainingDebt: number }

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

// Stream a POST response body to a browser download, honouring the server's Content-Disposition
// filename (falls back to `fallback`).
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
 * Talabnoma step's bulk actions for ONE firm × the selected snapshot:
 *  · «Reyestr (Excel)» — .xlsx of the UNSENT rows (hammasi | son) — the hippo import file.
 *  · «xat.hippo ga joʻnatish» — create a reyestr on hippo (qoralama | darhol), deduped against the «iz».
 *  · «Hamma talabnomalar» — background job → ZIP of one PDF letter per client.
 * Reyestr/joʻnatish are per-firm (a hippo reyestr is per firm). Dedupe: a client is never sent twice;
 * a count-batch walks the unsent set, so repeating «son» picks the NEXT N.
 */
export function TalabnomaBulk({ firmId, firmName, snapshotId, scopeLabel, firms = [], onSelectFirm }: {
  firmId?: number; firmName?: string; snapshotId?: number; scopeLabel: string;
  firms?: { firmId: number; firmName: string; total: number }[];
  onSelectFirm?: (id: number) => void;
}) {
  const n = (x: number) => x.toLocaleString('ru-RU');

  // Reyestr Excel state.
  const [xlsBusy, setXlsBusy] = useState(false);
  const [xlsErr, setXlsErr] = useState<string | null>(null);
  const xlsInFlight = useRef(false);

  // PDF (background job) state.
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);

  // Send state.
  const [sendBusy, setSendBusy] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const sendInFlight = useRef(false);

  // Shared modal (send | excel) — hammasi | belgilangan son.
  const [modalOpen, setModalOpen] = useState(false);
  const [modalKind, setModalKind] = useState<'send' | 'excel'>('send');
  const [sendAll, setSendAll] = useState(true);
  const [sendCount, setSendCount] = useState('');
  const [sendReal, setSendReal] = useState(false); // qoralama (false) | darhol joʻnatish (true)

  // Per-firm talabnoma totals split by the «iz».
  const [sum, setSum] = useState<Sum | null>(null);
  const [sumBusy, setSumBusy] = useState(false);
  const sumReqRef = useRef(0); // out-of-order guard: a stale firm's summary must not overwrite the current

  const needFirm = firmId == null || snapshotId == null;

  const loadSum = useCallback(async () => {
    if (firmId == null || snapshotId == null) { setSum(null); return; }
    const my = ++sumReqRef.current;
    setSumBusy(true);
    try {
      const res = await fetch(`/konveyer/talabnoma-summary?snapshotId=${snapshotId}&firmId=${firmId}`);
      const d = res.ok ? await res.json() : null;
      if (my !== sumReqRef.current) return; // a newer firm/snapshot superseded this response
      if (d && typeof d.count === 'number') {
        setSum({ count: d.count, sent: d.sent ?? 0, remaining: d.remaining ?? d.count, totalDebt: d.totalDebt ?? 0, remainingDebt: d.remainingDebt ?? 0 });
      }
    } catch { /* best-effort — the buttons still work without it */ }
    finally { if (my === sumReqRef.current) setSumBusy(false); }
  }, [firmId, snapshotId]);

  // Reset transient state on scope change, then (re)load the summary.
  useEffect(() => { setJobId(null); setJob(null); setErr(null); setXlsErr(null); setSendMsg(null); setSendErr(null); setSum(null); }, [firmId, snapshotId]);
  useEffect(() => { loadSum(); }, [loadSum]);
  // Reload when a hippo change is signalled (send here, or a cancel in the status panel).
  useEffect(() => {
    const onR = () => loadSum();
    window.addEventListener('hippo:refresh', onR);
    return () => window.removeEventListener('hippo:refresh', onR);
  }, [loadSum]);

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

  const total = sum?.count ?? 0;
  const sent = sum?.sent ?? 0;
  const remaining = sum?.remaining ?? 0;
  const parsedCount = Math.max(1, Math.min(remaining || 1, Math.floor(Number(sendCount)) || 0));
  const countValid = sendAll || (Number.isFinite(Number(sendCount)) && parsedCount >= 1 && parsedCount <= remaining);
  const modalBusy = modalKind === 'send' ? sendBusy : xlsBusy;
  const modalErr = modalKind === 'send' ? sendErr : xlsErr;
  const batchN = sendAll ? remaining : parsedCount;

  const downloadExcel = async (limit?: number) => {
    if (needFirm || xlsInFlight.current) return;
    xlsInFlight.current = true;
    setXlsBusy(true); setXlsErr(null);
    try {
      const res = await fetch('/konveyer/talabnoma-bulk-excel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, firmId, ...(limit ? { limit } : {}) }),
      });
      if (!res.ok) { let e = 'Excel yaratilmadi'; try { e = (await res.json()).error || e; } catch {} throw new Error(e); }
      await downloadFromResponse(res, 'Talabnoma_reyestr.xlsx');
      setModalOpen(false);
    } catch (e) { setXlsErr(e instanceof Error ? e.message : 'Excel yaratilmadi'); }
    finally { setXlsBusy(false); xlsInFlight.current = false; }
  };

  const sendToHippo = async (limit?: number, real = false) => {
    if (needFirm || sendInFlight.current) return;
    sendInFlight.current = true;
    setSendBusy(true); setSendErr(null); setSendMsg(null);
    try {
      const res = await fetch('/konveyer/hippo/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, firmId, mode: real ? 'send' : 'draft', ...(real ? { confirm: true } : {}), ...(limit ? { limit } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'xat.hippo ga yuborilmadi');
      setModalOpen(false);
      const rem = typeof data.remaining === 'number' ? ` · ${n(data.remaining)} qoldi` : '';
      setSendMsg(real
        ? `${n(data.count)} ta talabnoma joʻnatildi${data.registryId ? ` · reyestr #${data.registryId}` : ''}${rem}.`
        : `${n(data.count)} ta talabnoma yuklandi (qoralama${data.registryId ? ` · reyestr #${data.registryId}` : ''})${rem}. «Bekor / holat»ni pastdan koʻring.`);
      // Refresh the summary + nudge the status panel (sibling) so the new reyestr / qoralama shows.
      window.dispatchEvent(new CustomEvent('hippo:refresh'));
    } catch (e) { setSendErr(e instanceof Error ? e.message : 'xat.hippo ga yuborilmadi'); }
    finally { setSendBusy(false); sendInFlight.current = false; }
  };

  const openModal = (kind: 'send' | 'excel') => {
    setModalKind(kind);
    setSendErr(null); setXlsErr(null); setSendMsg(null);
    setSendAll(true); setSendReal(false); setSendCount(String(remaining || ''));
    setModalOpen(true);
  };
  const confirmModal = () => {
    const limit = sendAll ? undefined : parsedCount;
    if (modalKind === 'send') sendToHippo(limit, sendReal);
    else downloadExcel(limit);
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
  const made = job?.progress ?? 0;
  const expected = job?.total ?? 0;
  const short = done && expected > 0 && made < expected;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Talabnoma tayyorlash</div>
          <div className="mt-0.5 text-xs text-muted">Reyestr (Excel), xat.hippo ga joʻnatish va har mijozga PDF · {scopeLabel}</div>
        </div>
      </div>

      {needFirm ? (
        <div className="space-y-2.5">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
            Talabnoma reyestri (yoki xat.hippo ga joʻnatish) firma boʻyicha tayyorlanadi. Firmani tanlang. Umumiy koʻrinish uchun pastdagi «Umumiy statistika».
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
        <div className="space-y-2.5">
          {(sumBusy || sum) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {!sum && sumBusy
                ? <span className="inline-flex items-center gap-1.5 text-muted"><span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> Hisoblanmoqda…</span>
                : sum ? (<>
                    <span className="rounded-lg bg-surface-2 px-2 py-1 font-semibold tabular-nums">{n(total)} ta talabnoma</span>
                    {sent > 0 && <span className="rounded-lg bg-emerald-500/12 px-2 py-1 font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">✓ {n(sent)} joʻnatilgan</span>}
                    <span className="rounded-lg bg-surface-2 px-2 py-1 font-medium tabular-nums">{n(remaining)} qoldi</span>
                    <span className="rounded-lg bg-surface-2 px-2 py-1 font-medium tabular-nums text-muted">{n(sum.totalDebt)} soʻm qarzdorlik</span>
                  </>) : null}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {/* Reyestr (Excel) — modal: hammasi | son (unsent). */}
            <button
              onClick={() => openModal('excel')}
              disabled={remaining === 0}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg outline-none transition-colors hover:border-brand-500/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50"
              title={`«${firmName ?? 'firma'}» reyestrini Excel qilib olish (joʻnatilmaganlardan)`}
            >
              <Ico.sheet size={14} className="text-emerald-600 dark:text-emerald-400" />
              Reyestr (Excel){remaining ? ` · ${n(remaining)}` : ''}
            </button>

            {/* xat.hippo ga joʻnatish — modal: qoralama|darhol + hammasi|son. */}
            <button
              onClick={() => openModal('send')}
              disabled={remaining === 0}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-700 outline-none transition-colors hover:bg-brand-500/15 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50 dark:text-brand-300"
              title={`«${firmName ?? 'firma'}» reyestrini xat.hippo ga joʻnatish`}
            >
              <Ico.send size={14} />
              xat.hippo ga joʻnatish
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
                  : <><Ico.files size={14} /> Hamma talabnomalar (PDF){sum ? ` · ${n(total)}` : ''}</>}
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
                  <Ico.download size={14} />
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
          </div>
          {err && <span role="alert" className="block text-[11px] font-medium text-rose-500">{err}</span>}
          {sendMsg && <span role="status" className="block text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{sendMsg}</span>}
        </div>
      )}

      {/* Shared modal — send (qoralama|darhol) or excel; hammasi | belgilangan son (unsent). */}
      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={modalKind === 'send' ? 'xat.hippo ga joʻnatish' : 'Reyestr Excel'}>
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!modalBusy) setModalOpen(false); }} aria-hidden />
          <div className="animate-fade-in relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <button
              onClick={() => setModalOpen(false)}
              disabled={modalBusy}
              aria-label="Yopish"
              className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            >
              <Ico.close size={16} />
            </button>

            <div className="mb-1 flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm">
                {modalKind === 'send'
                  ? <Ico.send size={16} />
                  : <Ico.sheet size={16} />}
              </span>
              <div className="text-base font-semibold">{modalKind === 'send' ? 'Talabnoma joʻnatish' : 'Reyestr (Excel)'}</div>
            </div>

            {modalKind === 'send' && (
              <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl bg-surface-2 p-1">
                <button onClick={() => setSendReal(false)} className={cx('rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors', !sendReal ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>Qoralama</button>
                <button onClick={() => setSendReal(true)} className={cx('rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors', sendReal ? 'bg-brand-500 text-white shadow-sm' : 'text-muted hover:text-fg')}>Darhol joʻnatish</button>
              </div>
            )}

            <div className="mb-4 flex items-start gap-1.5 text-xs text-muted">
              <Ico.info size={14} className="mt-0.5 shrink-0" />
              <span>
                «{firmName ?? 'firma'}» ·{' '}
                {modalKind === 'excel'
                  ? <>joʻnatilmagan {n(remaining)} tadan reyestr (Excel) yuklab olinadi.</>
                  : sendReal
                    ? <><span className="font-medium text-rose-600 dark:text-rose-300">darhol joʻnatiladi</span> — notoʻgʻri boʻlsa «Bekor qilish»dan oʻchiriladi.</>
                    : <><span className="font-medium text-fg">qoralama</span> sifatida yuklanadi — keyin darhol joʻnatish yoki bekor qilasiz.</>}
              </span>
            </div>

            <div className="space-y-2">
              {/* Hammasi (unsent) */}
              <div
                role="radio" aria-checked={sendAll} tabIndex={0}
                onClick={() => setSendAll(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSendAll(true); } }}
                className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 outline-none transition-all', sendAll ? 'border-brand-500 bg-brand-500/[0.06] ring-1 ring-brand-500/30' : 'border-line hover:border-brand-500/30 hover:bg-surface-2')}
              >
                <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors', sendAll ? 'bg-brand-500 text-white' : 'bg-surface-2 text-muted')}>
                  <Ico.layer size={16} />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">Hammasi (qolgan)</span>
                  <span className="block text-xs text-muted tabular-nums">{n(remaining)} ta talabnoma</span>
                </span>
                <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors', sendAll ? 'border-brand-500' : 'border-line')}>
                  {sendAll && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}
                </span>
              </div>

              {/* Belgilangan son */}
              <div
                role="radio" aria-checked={!sendAll} tabIndex={0}
                onClick={() => setSendAll(false)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSendAll(false); } }}
                className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 outline-none transition-all', !sendAll ? 'border-brand-500 bg-brand-500/[0.06] ring-1 ring-brand-500/30' : 'border-line hover:border-brand-500/30 hover:bg-surface-2')}
              >
                <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors', !sendAll ? 'bg-brand-500 text-white' : 'bg-surface-2 text-muted')}>
                  <Ico.hashtag size={16} />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">Belgilangan son</span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <input
                      type="number" min={1} max={remaining || undefined} value={sendCount}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={() => setSendAll(false)}
                      onChange={(e) => setSendCount(e.target.value)}
                      className="w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm font-semibold tabular-nums outline-none transition-shadow focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/25"
                    />
                    <span className="text-xs text-muted tabular-nums">/ {n(remaining)} tadan</span>
                  </span>
                </span>
                <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors', !sendAll ? 'border-brand-500' : 'border-line')}>
                  {!sendAll && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}
                </span>
              </div>
            </div>

            <div className="mt-2 text-[11px] text-muted">Bir mijoz ikki marta joʻnatilmaydi — keyingi «son» qolganlaridan oladi.</div>

            {modalErr && <div role="alert" className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">{modalErr}</div>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setModalOpen(false)} disabled={modalBusy} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-50">Bekor</button>
              <button
                onClick={confirmModal}
                disabled={modalBusy || !countValid || remaining === 0}
                aria-busy={modalBusy}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-all focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
                  modalKind === 'send' && sendReal ? 'bg-rose-500 hover:bg-rose-600 focus-visible:ring-rose-500/40' : 'bg-brand-500 hover:bg-brand-600 focus-visible:ring-brand-500/40',
                )}
              >
                {modalBusy
                  ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {modalKind === 'send' ? 'Joʻnatilmoqda…' : 'Tayyorlanmoqda…'}</>
                  : modalKind === 'send'
                    ? <><Ico.send size={14} /> {sendReal ? 'Darhol joʻnatish' : 'xat.hippo ga yuklash'} ({n(batchN)})</>
                    : <><Ico.download size={14} /> Yuklab olish ({n(batchN)})</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
