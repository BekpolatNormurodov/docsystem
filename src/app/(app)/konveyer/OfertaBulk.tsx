'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico } from '@/ui';
import { Dropdown } from './Dropdown';

interface JobState { status: string; progress: number; total: number; message?: string | null }
interface Firm { firmId: number; firmName: string; total: number }

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => x.toLocaleString('ru-RU');

/**
 * «Oferta tayyorlash» — like Ariza yaratish, but renders the OFERTA (mikroqarz shartnomasi) PDFs:
 * one per contract, grouped by client, into one ZIP. Umumiy (all firms) or a picked firm; hammasi |
 * belgilangan son via the modal, with an optional sugʻurta (таъминот) %. Background job → poll → ZIP.
 */
export function OfertaBulk({ firms, snapshotId }: { firms: Firm[]; snapshotId?: number }) {
  const [firmId, setFirmId] = useState<number | null>(null); // null => Hamma firma
  const firm = firms.find((f) => f.firmId === firmId) ?? null;
  const firmOpts = [{ value: 'all', label: 'Hamma firma' }, ...firms.map((f) => ({ value: String(f.firmId), label: f.firmName, hint: n(f.total) }))];

  const [count, setCount] = useState<number | null>(null);
  const [countBusy, setCountBusy] = useState(false);

  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [all, setAll] = useState(true);
  const [num, setNum] = useState('');

  const loadCount = useCallback(async () => {
    if (snapshotId == null) { setCount(null); return; }
    setCountBusy(true);
    const params = new URLSearchParams({ snapshotId: String(snapshotId) });
    if (firmId != null) params.set('firmId', String(firmId));
    try {
      const res = await fetch(`/konveyer/prepare?${params.toString()}`);
      const d = res.ok ? await res.json() : null;
      if (d && typeof d.total === 'number') setCount(d.total);
    } catch { /* best-effort */ }
    finally { setCountBusy(false); }
  }, [firmId, snapshotId]);

  useEffect(() => { setJobId(null); setJob(null); setErr(null); setCount(null); }, [firmId, snapshotId]);
  useEffect(() => { loadCount(); }, [loadCount]);

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
      } catch { /* keep polling */ }
    };
    tick();
    timer.current = setInterval(tick, 2000);
    return () => { alive = false; if (timer.current) clearInterval(timer.current); };
  }, [jobId]);

  const total = count ?? 0;
  const parsed = Math.max(1, Math.min(total || 1, Math.floor(Number(num)) || 0));
  const valid = all || (Number.isFinite(Number(num)) && parsed >= 1 && parsed <= total);
  const batchN = all ? total : parsed;

  const openModal = () => { setErr(null); setAll(true); setNum(String(total || '')); setModalOpen(true); };

  const start = async () => {
    if (snapshotId == null || inFlight.current) return;
    inFlight.current = true;
    setStarting(true); setErr(null); setJob(null); setJobId(null);
    try {
      const res = await fetch('/konveyer/prepare-oferta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, firmId, ...(all ? {} : { limit: parsed }) }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error || 'Xatolik'); setModalOpen(false); return; }
      setJob({ status: 'PENDING', progress: 0, total: data.total });
      setJobId(data.jobId);
      setModalOpen(false);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Tarmoq xatosi'); }
    finally { setStarting(false); inFlight.current = false; }
  };

  const running = jobId != null && (job?.status === 'PENDING' || job?.status === 'RUNNING' || (!job && !err));
  const done = job?.status === 'DONE';
  const pct = job && job.total ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0;
  const scopeLabel = firm ? firm.firmName : 'Hamma firma';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div />
        <Dropdown value={firmId ? String(firmId) : 'all'} options={firmOpts} onChange={(v) => setFirmId(v === 'all' ? null : Number(v))} className="min-w-[220px]" />
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Oferta tayyorlash</div>
            <div className="mt-0.5 text-xs text-muted">Har shartnomaga oferta (mikroqarz shartnomasi) PDF → bitta ZIP (mijoz papkalari) · {scopeLabel}</div>
          </div>
          {countBusy && count == null
            ? <span className="h-6 w-20 shrink-0 animate-pulse rounded-lg bg-surface-2" aria-hidden />
            : count != null && <span className="shrink-0 rounded-lg bg-surface-2 px-2 py-1 text-xs font-semibold tabular-nums">{n(total)} mijoz</span>}
        </div>

        {/* Firmalar boʻyicha sonlar — «Hamma firma»da har firma va soni (bosilsa oʻsha firma tanlanadi). */}
        {firmId == null && (
          countBusy && count == null
            ? <div className="mb-3 flex flex-wrap gap-1.5">{Array.from({ length: 6 }).map((_, i) => <span key={i} className="h-7 w-28 animate-pulse rounded-lg bg-surface-2" />)}</div>
            : firms.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {firms.map((f) => (
                  <button key={f.firmId} onClick={() => setFirmId(f.firmId)} disabled={!!running || starting}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium outline-none transition-colors hover:border-brand-500/50 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50"
                    title={`«${f.firmName}» boʻyicha oferta tayyorlash`}>
                    <span className="max-w-[13rem] truncate">{f.firmName}</span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 tabular-nums text-[11px] text-muted">{n(f.total)}</span>
                  </button>
                ))}
              </div>
            )
        )}

        {/* Holat: idle → tugma; running → foizli progress; done → yuklab olish. */}
        {running ? (
          <div className="rounded-xl border border-brand-500/25 bg-brand-500/[0.04] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> Yaratilmoqda…
              </span>
              <span className="text-lg font-bold tabular-nums text-brand-700 dark:text-brand-300">{pct}%</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted tabular-nums">
              <span>{n(job?.progress ?? 0)} / {n(job?.total ?? 0)} mijoz</span>
              {job?.message && <span className="font-medium text-fg">{job.message}</span>}
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : done ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/export/${jobId}/download`} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 outline-none transition-colors hover:bg-emerald-500/15 focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-300">
              <Ico.download size={14} /> {job?.message || `${n(job?.total ?? 0)} tayyor`} — yuklab olish
            </a>
            <button onClick={() => { setJobId(null); setJob(null); loadCount(); }} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2">Yana</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openModal}
              disabled={starting || total === 0}
              aria-busy={starting}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-all hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-wait disabled:opacity-60"
              title={`«${scopeLabel}» boʻyicha ofertalarni yaratish`}
            >
              {starting ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Boshlanmoqda…</> : <><Ico.flash size={14} /> Oferta yaratish{count != null ? ` (${n(total)})` : ''}</>}
            </button>
            {err && <span role="alert" className="text-[11px] font-medium text-rose-500">{err}</span>}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Oferta tayyorlash">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!starting) setModalOpen(false); }} aria-hidden />
          <div className="animate-fade-in relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <button onClick={() => setModalOpen(false)} disabled={starting} aria-label="Yopish" className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40">
              <Ico.close size={16} />
            </button>
            <div className="mb-1 flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm"><Ico.flash size={16} /></span>
              <div className="text-base font-semibold">Oferta tayyorlash</div>
            </div>
            <div className="mb-4 text-xs text-muted">«{scopeLabel}» · og‘ir jarayon — orqada yaratiladi, tayyor bo‘lgach ZIP yuklab olasiz.</div>

            <div className="space-y-2">
              <div role="radio" aria-checked={all} tabIndex={0} onClick={() => setAll(true)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAll(true); } }}
                className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 outline-none transition-all', all ? 'border-brand-500 bg-brand-500/[0.06] ring-1 ring-brand-500/30' : 'border-line hover:border-brand-500/30 hover:bg-surface-2')}>
                <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors', all ? 'bg-brand-500 text-white' : 'bg-surface-2 text-muted')}><Ico.layer size={16} /></span>
                <span className="flex-1"><span className="block text-sm font-semibold">Hammasi</span><span className="block text-xs text-muted tabular-nums">{n(total)} mijoz</span></span>
                <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors', all ? 'border-brand-500' : 'border-line')}>{all && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}</span>
              </div>
              <div role="radio" aria-checked={!all} tabIndex={0} onClick={() => setAll(false)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAll(false); } }}
                className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 outline-none transition-all', !all ? 'border-brand-500 bg-brand-500/[0.06] ring-1 ring-brand-500/30' : 'border-line hover:border-brand-500/30 hover:bg-surface-2')}>
                <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors', !all ? 'bg-brand-500 text-white' : 'bg-surface-2 text-muted')}><Ico.hashtag size={16} /></span>
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

            <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
              <Ico.info size={14} className="mt-0.5 shrink-0" />
              <span>Sugʻurta (taʼminot) summasi <b className="font-medium text-fg">portfeldan</b> — har shartnomaning oʻz maʼlumotidan (sugʻurta summasining 4%) avtomatik olinadi. Qoʻlda kiritilmaydi.</span>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setModalOpen(false)} disabled={starting} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-50">Bekor</button>
              <button onClick={start} disabled={starting || !valid || total === 0} aria-busy={starting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-all hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60">
                {starting ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Boshlanmoqda…</> : <><Ico.flash size={14} /> Yaratish ({n(batchN)})</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
