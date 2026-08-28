'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico } from '@/ui';
import { GeneratedList } from './GeneratedList';

interface JobState { status: string; progress: number; total: number; message?: string | null }
interface HistItem { id: number; total: number; createdAt: string; firmName: string; size: number }
interface CourtOpt { id: number; shortName: string; dailyQuota: number; cutoffMinutes: number; remaining: number; open: boolean }
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const fmtWhen = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

/**
 * «Ariza yaratish» (Arizani tayyorlash) — builds ONLY the court ariza, one document per client,
 * into one ZIP (a folder per person). This is the Sanoat palatasi step: only the ariza is printed
 * and taken to the chamber, so talabnoma / oferta / grafik / firm docs are NOT bundled here — those
 * belong to the Sudga-yuborish packet. Umumiy (all firms) or a picked firm; hammasi | belgilangan
 * son via the modal. States live on the Job row and are polled here.
 */
export function ArizaBulk({ firmId, firmName, snapshotId, scopeLabel }: {
  firmId?: number; firmName?: string; snapshotId?: number; scopeLabel: string;
}) {
  const n = (x: number) => x.toLocaleString('ru-RU');

  const [count, setCount] = useState<number | null>(null); // hali ariza chiqmaganlar (generatsiya shularga)
  const [totalAll, setTotalAll] = useState<number | null>(null); // umumiy mijozlar
  const [doneCount, setDoneCount] = useState(0); // allaqachon arizasi chiqqanlar
  const [courts, setCourts] = useState<CourtOpt[]>([]);
  const [courtNums, setCourtNums] = useState<Record<number, string>>({}); // ko'p sudli firma: har sudga son
  const [countBusy, setCountBusy] = useState(false);
  const countReqRef = useRef(0); // out-of-order guard: a stale firm/snapshot count must not overwrite the current

  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);

  // Modal (hammasi | son).
  const [modalOpen, setModalOpen] = useState(false);
  const [all, setAll] = useState(true);
  const [num, setNum] = useState('');

  // «Tayyorlanganlar» — persisted history of finished ariza jobs (download / delete).
  const [history, setHistory] = useState<HistItem[]>([]);
  const [histOpen, setHistOpen] = useState(false);
  const [delId, setDelId] = useState<number | null>(null);

  const loadCount = useCallback(async () => {
    if (snapshotId == null) { setCount(null); return; }
    const my = ++countReqRef.current;
    setCountBusy(true);
    const params = new URLSearchParams({ snapshotId: String(snapshotId), arizaOnly: '1' });
    if (firmId != null) params.set('firmId', String(firmId));
    try {
      const res = await fetch(`/konveyer/prepare?${params.toString()}`);
      const d = res.ok ? await res.json() : null;
      if (my !== countReqRef.current) return; // a newer firm/snapshot superseded this response
      if (d && typeof d.remaining === 'number') setCount(d.remaining); else if (d && typeof d.total === 'number') setCount(d.total);
      if (d && typeof d.total === 'number') setTotalAll(d.total);
      if (d && typeof d.done === 'number') setDoneCount(d.done);
      if (d && Array.isArray(d.courts)) setCourts(d.courts);
      // Reload'da davom etayotgan generatsiyaga qayta ulanamiz (progress yo'qolmaydi).
      if (d?.activeJob && jobId == null) { setJobId(d.activeJob.id); setJob({ status: 'RUNNING', progress: d.activeJob.progress ?? 0, total: d.activeJob.total ?? 0 }); }
    } catch { /* best-effort */ }
    finally { if (my === countReqRef.current) setCountBusy(false); }
  }, [firmId, snapshotId]);

  const loadHistory = useCallback(async () => {
    if (snapshotId == null) { setHistory([]); return; }
    const params = new URLSearchParams({ snapshotId: String(snapshotId) });
    if (firmId != null) params.set('firmId', String(firmId));
    try {
      const res = await fetch(`/konveyer/ariza-history?${params.toString()}`);
      const d = res.ok ? await res.json() : null;
      if (d && Array.isArray(d.items)) setHistory(d.items);
    } catch { /* best-effort */ }
  }, [firmId, snapshotId]);

  useEffect(() => { setJobId(null); setJob(null); setErr(null); setCount(null); setTotalAll(null); setDoneCount(0); }, [firmId, snapshotId]);
  useEffect(() => { loadCount(); }, [loadCount]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  // Refresh the history the moment a generation finishes, so the new ZIP appears.
  useEffect(() => { if (job?.status === 'DONE') loadHistory(); }, [job?.status, loadHistory]);

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
        if (s.status === 'DONE' || s.status === 'FAILED' || s.status === 'CANCELED') {
          if (timer.current) clearInterval(timer.current);
          if (s.status === 'FAILED') setErr(s.message || 'Xatolik');
          // «Bekor» → ZIP o'chirildi, hech narsa yuklab olinmaydi; idle holatga qaytamiz.
          if (s.status === 'CANCELED') { setJobId(null); setJob(null); loadCount(); }
        }
      } catch { /* transient poll error — keep polling */ }
    };
    tick();
    timer.current = setInterval(tick, 2000);
    return () => { alive = false; if (timer.current) clearInterval(timer.current); };
  }, [jobId]);

  const total = count ?? 0;
  const parsed = Math.max(1, Math.min(total || 1, Math.floor(Number(num)) || 0));
  // Ariza SUDGA bog'lanadi va sud FIRMAGA bog'liq (Bright'da 2 ta) — «Hamma firma» ko'rinishida sudni
  // biriktirib bo'lmaydi, shuning uchun blanket «Hammasi» yo'q: avval firmani tanlash shart.
  const noFirm = firmId == null;
  const firmNoCourt = !noFirm && count != null && courts.length === 0;
  const multiCourt = courts.length > 1;
  const courtSum = courts.reduce((s, c) => s + (Math.max(0, Math.floor(Number(courtNums[c.id])) || 0)), 0);
  const valid = multiCourt
    ? courtSum >= 1 && courtSum <= total
    : all || (Number.isFinite(Number(num)) && parsed >= 1 && parsed <= total);
  const batchN = multiCourt ? courtSum : all ? total : parsed;

  const openModal = () => {
    setErr(null); setAll(true); setNum(String(total || ''));
    // Ko'p sudli firma: har sudga uning KUNLIK limiti (dailyQuota)ni default qilamiz — generatsiya
    // sudning bugungi «oynasi»ga (cutoff/dam olish) bog'liq EMAS (u faqat «Sudga yuborish»da ishlaydi),
    // shuning uchun sud yopiq bo'lsa ham 0 emas, quota bo'yicha to'ldiramiz (jami scopedan oshmasin).
    if (courts.length > 1) {
      const init: Record<number, string> = {}; let left = total;
      for (const c of courts) { const v = Math.max(0, Math.min(left, c.dailyQuota)); init[c.id] = String(v); left -= v; }
      setCourtNums(init);
    }
    setModalOpen(true);
  };

  const start = async () => {
    if (snapshotId == null || inFlight.current || noFirm || firmNoCourt) return; // ariza sudga bog'lanadi — firma+sud shart
    inFlight.current = true;
    setStarting(true); setErr(null); setJob(null); setJobId(null);
    try {
      // Sud bo'yicha taqsimot: ko'p sudli firma → har sudga o'z soni; bitta sud → hammasi/son shu sudga;
      // sud yo'q (konfiguratsiyasiz) → eski xatti-harakat (courtCounts'siz).
      const courtCounts = multiCourt
        ? courts.map((c) => ({ courtId: c.id, count: Math.max(0, Math.floor(Number(courtNums[c.id])) || 0) })).filter((c) => c.count > 0)
        : courts.length === 1
          ? [{ courtId: courts[0].id, count: batchN }]
          : [];
      const res = await fetch('/konveyer/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, firmId, arizaOnly: true, ...(all && !multiCourt ? {} : { limit: parsed }), ...(courtCounts.length ? { courtCounts } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error || 'Xatolik'); setModalOpen(false); return; }
      setJob({ status: 'PENDING', progress: 0, total: data.total });
      setJobId(data.jobId);
      setModalOpen(false);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Tarmoq xatosi'); }
    finally { setStarting(false); inFlight.current = false; }
  };

  const del = async (id: number) => {
    setDelId(id);
    try {
      const res = await fetch(`/api/export/${id}`, { method: 'DELETE' });
      if (res.ok) setHistory((h) => h.filter((x) => x.id !== id));
    } catch { /* keep the row on a transient error */ }
    finally { setDelId(null); }
  };

  const running = jobId != null && (job?.status === 'PENDING' || job?.status === 'RUNNING' || (!job && !err));
  const done = job?.status === 'DONE';
  const pct = job && job.total ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Ariza yaratish</div>
          <div className="mt-0.5 text-xs text-muted">Har mijozning <b className="font-medium text-fg">arizasini</b> (bitta hujjat) yaratadi → bitta ZIP · {scopeLabel}. Faqat ariza — palataga print qilib beriladi.</div>
        </div>
        {(countBusy || totalAll != null) && (
          <span className="shrink-0 rounded-lg bg-surface-2 px-2 py-1 text-xs font-semibold tabular-nums">
            {countBusy && totalAll == null ? '…' : (
              <>
                {n(totalAll ?? 0)} mijoz
                {doneCount > 0 && <span className="ml-1 font-normal text-emerald-600 dark:text-emerald-400">· {n(count ?? 0)} qoldi</span>}
              </>
            )}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!done && noFirm ? (
          // «Hamma firma» — sud biriktirib bo'lmaydi (sud firmaga bog'liq, Bright'da 2 ta). Firmani tanlash shart.
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
            <Ico.info size={14} className="shrink-0" />
            <span>Ariza sudga bogʻlanadi — avval yuqoridan <b>firmani tanlang</b> (Bright'da 2 sud).</span>
          </div>
        ) : !done && firmNoCourt ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
            <Ico.info size={14} className="shrink-0" />
            <span>Bu firmaga sud biriktirilmagan — «Sudlar» boʻlimida biriktiring.</span>
          </div>
        ) : !done && !running && total === 0 && doneCount > 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <Ico.check size={14} className="shrink-0" />
            <span>Hammasi tayyor — {n(doneCount)} ta arizaga ariza chiqarilgan. Yangi mijoz qoʻshilsa shu yerda chiqadi.</span>
          </div>
        ) : !done ? (
          <button
            onClick={openModal}
            disabled={!!running || starting || total === 0}
            aria-busy={!!running || starting}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-all hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-wait disabled:opacity-60"
            title={`«${scopeLabel}» boʻyicha arizalarni yaratish`}
          >
            {running
              ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Yaratilmoqda… {job?.progress ?? 0}/{job?.total ?? ''}</>
              : <><Ico.flash size={14} /> Ariza yaratish</>}
          </button>
        ) : (
          <a
            href={`/api/export/${jobId}/download`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 outline-none transition-colors hover:bg-emerald-500/15 focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-300"
          >
            <Ico.download size={14} />
            {n(job?.total ?? 0)} ta ariza tayyor — yuklab olish
          </a>
        )}
        {done && (
          <button onClick={() => { setJobId(null); setJob(null); loadCount(); }} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2">Yana</button>
        )}

        {running && job && job.total > 0 && (
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <span className="block h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
          </span>
        )}
        {err && <span role="alert" className="text-[11px] font-medium text-rose-500">{err}</span>}
      </div>

      {history.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border border-line">
          <button
            type="button"
            onClick={() => setHistOpen((v) => !v)}
            aria-expanded={histOpen}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
          >
            <Ico.archive size={14} className="text-brand-600 dark:text-brand-400" />
            <span className="text-xs font-semibold">Tayyorlangan arizalar</span>
            <span className="rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300">{history.length}</span>
            <span className="ml-auto text-[11px] text-muted">{histOpen ? 'Yopish' : 'Koʻrish'}</span>
            <Ico.chevron size={14} className={`text-muted transition-transform ${histOpen ? 'rotate-90' : ''}`} />
          </button>
          {histOpen && (
            <div className="divide-y divide-line border-t border-line">
              {history.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs">
                  <span className="font-semibold tabular-nums">{n(h.total)} ariza</span>
                  <span className="text-muted">· {fmtSize(h.size)}</span>
                  <span className="max-w-[10rem] truncate text-muted" title={h.firmName}>· {h.firmName}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted">{fmtWhen(h.createdAt)}</span>
                  <a
                    href={`/api/export/${h.id}/download`}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-brand-600 transition-colors hover:bg-brand-500/10 dark:text-brand-400"
                  >
                    <Ico.download size={12} /> Yuklab olish
                  </a>
                  <button
                    type="button"
                    onClick={() => del(h.id)}
                    disabled={delId === h.id}
                    aria-label="Oʻchirish"
                    className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"
                  >
                    {delId === h.id ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Ico.trash size={13} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Yaratilgan arizalar — mijoz darajasида (PINFL + F.I.O), «N ta chiqdi» + qidiruv. */}
      <GeneratedList type="ariza" snapshotId={snapshotId} firmId={firmId} count={doneCount} />

      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Ariza yaratish">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!starting) setModalOpen(false); }} aria-hidden />
          <div className="animate-fade-in relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <button onClick={() => setModalOpen(false)} disabled={starting} aria-label="Yopish" className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40">
              <Ico.close size={16} />
            </button>
            <div className="mb-1 flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm">
                <Ico.flash size={16} />
              </span>
              <div className="text-base font-semibold">Ariza yaratish</div>
            </div>
            <div className="mb-4 flex items-start gap-1.5 text-xs text-muted">
              <Ico.info size={14} className="mt-0.5 shrink-0" />
              <span>«{firmName ?? 'Hamma firma'}» · faqat ariza — orqada yaratiladi, tayyor boʻlgach ZIP yuklab olasiz.</span>
            </div>

            {multiCourt ? (
              <div className="space-y-2">
                <div className="text-xs text-muted">Har sudga nechtadan ariza chiqarilsin — sonini belgilang. Tanlangan case'lar shu sud nomiga chiqadi va bitta ZIP'ga yig'iladi.</div>
                {courts.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{c.shortName}</span>
                      <span className="block text-[11px] tabular-nums text-muted">
                        limit {n(c.dailyQuota)}/kun · {hhmm(c.cutoffMinutes)} gacha · {c.open ? `bugun ${n(c.remaining)} qoldi` : 'bugun yopiq'}
                      </span>
                    </span>
                    <input type="number" min={0} value={courtNums[c.id] ?? ''} onChange={(e) => setCourtNums((m) => ({ ...m, [c.id]: e.target.value }))}
                      className="w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm font-semibold tabular-nums outline-none focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/25" />
                  </div>
                ))}
                <div className="flex items-center justify-between px-1 text-[11px] tabular-nums text-muted">
                  <span>Jami: <b className={courtSum > total ? 'text-rose-500' : 'text-fg'}>{n(courtSum)}</b> / {n(total)} mijoz</span>
                  {courtSum > total && <span className="text-rose-500">Scopedan oshib ketdi</span>}
                </div>
              </div>
            ) : (
            <div className="space-y-2">
              {courts.length === 1 && <div className="rounded-lg bg-surface-2 px-3 py-1.5 text-[11px] text-muted">Sud: <b className="text-fg">{courts[0].shortName}</b> · limit {n(courts[0].dailyQuota)}/kun, {hhmm(courts[0].cutoffMinutes)} gacha</div>}
              <div role="radio" aria-checked={all} tabIndex={0} onClick={() => setAll(true)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAll(true); } }}
                className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 outline-none transition-all', all ? 'border-brand-500 bg-brand-500/[0.06] ring-1 ring-brand-500/30' : 'border-line hover:border-brand-500/30 hover:bg-surface-2')}>
                <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors', all ? 'bg-brand-500 text-white' : 'bg-surface-2 text-muted')}>
                  <Ico.layer size={16} />
                </span>
                <span className="flex-1"><span className="block text-sm font-semibold">Hammasi</span><span className="block text-xs text-muted tabular-nums">{n(total)} mijoz</span></span>
                <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors', all ? 'border-brand-500' : 'border-line')}>{all && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}</span>
              </div>
              <div role="radio" aria-checked={!all} tabIndex={0} onClick={() => setAll(false)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAll(false); } }}
                className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 outline-none transition-all', !all ? 'border-brand-500 bg-brand-500/[0.06] ring-1 ring-brand-500/30' : 'border-line hover:border-brand-500/30 hover:bg-surface-2')}>
                <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors', !all ? 'bg-brand-500 text-white' : 'bg-surface-2 text-muted')}>
                  <Ico.hashtag size={16} />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">Belgilangan son</span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <input type="number" min={1} max={total || undefined} value={num} onClick={(e) => e.stopPropagation()} onFocus={() => setAll(false)} onChange={(e) => setNum(e.target.value)}
                      className="w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm font-semibold tabular-nums outline-none transition-shadow focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/25" />
                    <span className="text-xs text-muted tabular-nums">/ {n(total)} tadan</span>
                  </span>
                </span>
                <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors', !all ? 'border-brand-500' : 'border-line')}>{!all && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}</span>
              </div>
            </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setModalOpen(false)} disabled={starting} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-50">Bekor</button>
              <button onClick={start} disabled={starting || !valid || total === 0} aria-busy={starting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-all hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60">
                {starting
                  ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Boshlanmoqda…</>
                  : <><Ico.flash size={14} /> Yaratish ({n(batchN)})</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
