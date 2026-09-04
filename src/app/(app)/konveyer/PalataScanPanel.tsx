'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface FirmStat { firm: string; total: number; matched: number; withCase: number; saved: number }
interface ScanRow { reg: string; name: string; pinfl: string; firm: string; address: string; hasCase: boolean; hasPortfolio: boolean; hasScan: boolean; caseId: number | null; linked: boolean }
interface Summary { total: number; matched: number; withCase: number; noCase: number; saved: number; firms: FirmStat[]; arizas: ScanRow[]; updatedAt: string | null }
interface OcrJob { id: number; status: string; progress: number; total: number; message: string | null }
interface QueueItem { file: string; name: string; uploadedAt: number | null; pages: number; active: boolean }

const n = (x: number) => x.toLocaleString('ru-RU');
const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

// «Palatadan kelgan» — imzolangan arizalar skanini yuklang; server (1) OCR qilib firma +
// PINFL + F.I.O ajratadi, (2) har arizani ALOHIDA PDF qilib bazaga (case) saqlaydi — shunda
// imzolangan ariza sud paketiga avtomat kiradi. Ikkala bosqich ham fon (background) jarayon.
export function PalataScanPanel() {
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [onlyNoCase, setOnlyNoCase] = useState(false);
  const [firmFilter, setFirmFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);        // uploading
  const [cancelling, setCancelling] = useState(false); // stopping a live OCR job
  const [saving, setSaving] = useState(false);    // starting the manual attach job
  const [confirmSave, setConfirmSave] = useState(false); // «Saqlansinmi?» tasdiq oynasi
  const [update, setUpdate] = useState(true);     // re-scan overwrites already-saved PDFs (default ON)
  const [job, setJob] = useState<OcrJob | null>(null); // live OCR / attach job
  const [queue, setQueue] = useState<QueueItem[]>([]); // OCR navbati (o'qilayotgan + kutayotgan)
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRunning = useRef(false);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/konveyer/palata-scan', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      setS(await res.json());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); }
    finally { setLoading(false); }
  }, []);

  // Poll BOTH the OCR and the attach jobs; show whichever is live (with its phase
  // message). When a live job finishes, reload the summary once.
  const poll = useCallback(async () => {
    try {
      const [a, b, q] = await Promise.all([
        fetch('/konveyer/palata-ocr', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        fetch('/konveyer/palata-attach', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        fetch('/konveyer/palata-ocr/queue', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ items: [] })),
      ]);
      setQueue(Array.isArray(q?.items) ? q.items : []);
      const jobs: OcrJob[] = [a?.job, b?.job].filter(Boolean);
      const active = jobs.find((j) => j.status === 'RUNNING' || j.status === 'PENDING') ?? null;
      setJob(active);
      if (active) {
        wasRunning.current = true;
        pollRef.current = setTimeout(poll, 1500);
        return;
      }
      const failed = jobs.find((j) => j.status === 'FAILED');
      if (failed) setErr(failed.message || 'Xatolik');
      // Only refresh after a run we were watching actually ended (avoids a spurious
      // reload on first mount when nothing is running).
      if (wasRunning.current) { wasRunning.current = false; await loadSummary(); }
    } catch { /* transient — stop polling silently */ }
  }, [loadSummary]);

  useEffect(() => {
    loadSummary();
    poll(); // resume if a job is already running from before
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [loadSummary, poll]);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      Array.from(list).forEach((f) => fd.append('files', f));
      fd.append('update', String(update));
      const res = await fetch('/konveyer/palata-ocr', { method: 'POST', body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error || 'Yuklab boʻlmadi'); }
      const d = await res.json().catch(() => ({} as { queued?: boolean }));
      // Navbatga qo'shilgan bo'lsa — joriy progress'ni nolga tushirmaymiz (poll haqiqiy holatni beradi).
      if (!d?.queued) setJob({ id: 0, status: 'PENDING', progress: 0, total: 0, message: null });
      wasRunning.current = true;
      poll();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Yuklab boʻlmadi');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
      setBusy(false);
    }
  };

  // «Bazaga saqlash» — re-run the split-&-attach over the whole dataset (idempotent),
  // to pick up clients whose cases were created after the scan was read.
  const saveToDb = async () => {
    setSaving(true); setErr(null); setConfirmSave(false);
    try {
      const res = await fetch('/konveyer/palata-attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace: update }), // «Mavjudlarni yangilash» (default ON)
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error || 'Boshlab boʻlmadi'); }
      setJob({ id: 0, status: 'PENDING', progress: 0, total: 0, message: 'Bazaga saqlanmoqda…' });
      wasRunning.current = true;
      poll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Boshlab boʻlmadi');
    } finally { setSaving(false); }
  };

  const running = !!job && (job.status === 'RUNNING' || job.status === 'PENDING');
  const attaching = running && /saqla/i.test(job?.message || '');

  // «Bekor qilish» — ishlab turgan OCR jarayonini to'xtatadi (server bo'lak orasida uzadi).
  const cancelOcr = async () => {
    setCancelling(true);
    try { await fetch('/konveyer/palata-ocr', { method: 'DELETE' }); poll(); }
    catch { /* keyingi poll holatni ko'rsatadi */ }
    finally { setCancelling(false); }
  };

  // Navbatdagi (hali o'qilmagan) bitta faylni o'chirish.
  const removeQueued = async (file: string) => {
    setQueue((qs) => qs.filter((x) => x.file !== file)); // optimistik
    try { await fetch(`/konveyer/palata-ocr/queue?file=${encodeURIComponent(file)}`, { method: 'DELETE' }); }
    catch { /* keyingi poll haqiqiy holatni beradi */ }
    finally { poll(); }
  };
  const pct = job && job.total > 0 ? Math.round((job.progress / job.total) * 100) : null;
  const runLabel = busy ? 'Yuklanmoqda…' : attaching ? `Bazaga saqlanmoqda${pct != null ? ` · ${pct}%` : '…'}` : running ? `OCR ishlayapti${pct != null ? ` · ${pct}%` : '…'}` : 'Skanerlangan PDF(lar)ni yuklang';

  const savedTotal = s?.saved ?? 0;

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M8 2v4M16 2v4M4 10h16" /></svg>
        </span>
        <div className="text-sm font-semibold">Palatadan kelgan (imzolangan skan)</div>
      </div>
      <div className="mb-4 text-xs text-muted">Skanerlangan arizalarni yuklang — server OCR qilib firma, PINFL va F.I.O ni ajratadi, soʻng har arizani <b className="font-medium text-fg">alohida PDF</b> qilib mijoz ishiga (case) bazaga saqlaydi. Shunda imzolangan ariza sud paketiga avtomat qoʻshiladi.</div>

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
        <div className="text-sm font-medium">{runLabel}</div>
        <div className="text-[11px] text-muted">
          {running && job!.total > 0 ? `${n(job!.progress)} / ${n(job!.total)} ${attaching ? 'ariza' : 'sahifa'}` : running ? 'boshlanmoqda…' : 'bosing yoki tashlang · PDF · bir nechta'}
        </div>
        {running && pct != null && (
          <div className={`mt-1 h-1 w-40 overflow-hidden rounded-full ${attaching ? 'bg-emerald-500/15' : 'bg-violet-500/15'}`}>
            <div className={`h-full rounded-full transition-all ${attaching ? 'bg-emerald-500' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        <input ref={fileRef} type="file" multiple accept=".pdf,application/pdf" className="hidden" onChange={onFiles} />
      </div>

      {/* OCR ishlab turganda: navbatga yana PDF qo'shish + bekor qilish. */}
      {running && !attaching && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => !busy && fileRef.current?.click()} disabled={busy} aria-busy={busy}
            title="Ish ketayotganda ham yangi PDF qo'shsangiz — navbatga tushadi, ketma-ket o'qiladi"
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-violet-600 outline-none transition-colors hover:bg-violet-500/12 focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-wait disabled:opacity-60 dark:text-violet-300">
            {busy
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>}
            {busy ? 'Qoʻshilmoqda…' : 'Yana PDF qoʻshish (navbatga)'}
          </button>
          <button type="button" onClick={cancelOcr} disabled={cancelling} aria-busy={cancelling}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 outline-none transition-colors hover:bg-rose-500/12 focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:cursor-wait disabled:opacity-60 dark:text-rose-300">
            {cancelling
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>}
            {cancelling ? 'Toʻxtatilmoqda…' : 'Bekor qilish'}
          </button>
        </div>
      )}

      {/* Navbat ro'yxati — har fayl: nom, qachon yuklangani, necha sahifa, holati. */}
      {queue.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl border border-line">
          <div className="flex items-center justify-between bg-surface-2/50 px-3 py-1.5 text-[11px] font-medium text-muted">
            <span>Navbat — {n(queue.length)} ta fayl</span>
            <span>{update ? 'ustiga yoziladi (replace)' : 'eskisi saqlanadi'}</span>
          </div>
          <ul className="divide-y divide-line/60">
            {queue.map((it) => (
              <li key={it.file} className={`flex items-center gap-2.5 px-3 py-2 text-[12px] ${it.active ? 'bg-violet-500/[0.05]' : ''}`}>
                {it.active
                  ? <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" title="Hozir oʻqilyapti" />
                  : <svg className="h-3.5 w-3.5 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><title>Navbatda</title><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" title={it.name}>{it.name}</div>
                  <div className="text-[11px] text-muted">
                    {it.uploadedAt ? fmtWhen(new Date(it.uploadedAt).toISOString()) : '—'}
                    {it.pages > 0 && <> · <span className="tabular-nums">{n(it.pages)}</span> sahifa</>}
                  </div>
                </div>
                {it.active
                  ? <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">oʻqilyapti{pct != null ? ` ${pct}%` : ''}</span>
                  : (
                    <>
                      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">navbatda</span>
                      <button type="button" onClick={() => removeQueued(it.file)} title="Navbatdan olib tashlash"
                        className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    </>
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Re-scan control — overwrite already-saved clients or keep them. */}
      <label className={`mb-3 flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${update ? 'border-amber-500/40 bg-amber-500/[0.05]' : 'border-line bg-surface hover:bg-surface-2/50'} ${busy || running ? 'pointer-events-none opacity-60' : ''}`}>
        {/* Native checkbox yashirin (ba'zi brauzerlar qora kvadrat chizadi) — o'rniga o'z belgimiz (fokus halqasi saqlanadi). */}
        <input type="checkbox" checked={update} disabled={busy || running} onChange={(e) => setUpdate(e.target.checked)} className="peer sr-only" />
        <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500/40 ${update ? 'border-amber-500 bg-amber-500 text-white' : 'border-line bg-surface'}`}>
          {update && <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
        </span>
        <span className="min-w-0">
          <span className="block text-[12px] font-medium">Mavjudlarni yangilash</span>
          <span className="block text-[11px] leading-relaxed text-muted">
            Yangi skanda avval saqlangan mijoz boʻlsa, uning PDFʼi qayta yoziladi (eskisi oʻrniga).
            {savedTotal > 0 && <> Hozir bazada <b className="font-medium text-fg">{n(savedTotal)}</b> ta saqlangan.</>}
            {' '}Belgilanmasa — eskisi tegilmaydi, yangi yuklama esa saqlanib turadi.
          </span>
        </span>
      </label>

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
          {(() => {
            const waiting = Math.max(0, s.withCase - s.saved);
            const w = (x: number) => `${s.total ? (x / s.total) * 100 : 0}%`;
            const rows = [
              { key: 'saved', dot: 'bg-emerald-500', label: 'Sudga tayyor', value: savedTotal, tone: 'text-emerald-600 dark:text-emerald-400', desc: 'alohida PDF qilib mijoz ishiga bazaga saqlangan' },
              { key: 'wait', dot: 'bg-amber-400', label: 'Saqlanishi kutmoqda', value: waiting, tone: 'text-amber-600 dark:text-amber-400', desc: 'konveyerda ishi bor, lekin hali PDF qilib saqlanmagan' },
              { key: 'nocase', dot: 'bg-slate-400/60', label: 'Mos ish topilmadi', value: s.noCase, tone: 'text-muted', desc: 'skan keldi, lekin bu shaxs konveyerda ish (case) sifatida yoʻq — roʻyxatda emas yoki boshqa firma' },
            ];
            return (
              <div className="mb-3 rounded-xl border border-line bg-surface-2/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-medium text-muted">Palatadan imzolangan boʻlib qaytgan skan</div>
                    <div className="text-2xl font-bold tabular-nums">{n(s.total)}<span className="ml-1 text-xs font-medium text-muted">ta ariza</span></div>
                    {/* Bu — OXIRGI yuklangan skan roʻyxati (yangi skan qilmaguningizcha shu turadi). */}
                    {s.updatedAt && <div className="mt-0.5 text-[11px] text-muted">oxirgi skan: <b className="font-medium text-fg">{fmtWhen(s.updatedAt)}</b></div>}
                  </div>
                  {waiting > 0 && (
                    <button type="button" onClick={() => setConfirmSave((v) => !v)} disabled={saving || running} aria-busy={saving || running} aria-expanded={confirmSave}
                      title="Ishi bor, lekin hali saqlanmaganlarni alohida PDF qilib bazaga saqlaydi"
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-wait disabled:opacity-60 ${confirmSave ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700' : 'border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-300'}`}>
                      {saving || (running && attaching)
                        ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>}
                      {n(waiting)} tasini saqlash
                    </button>
                  )}
                </div>
                {/* Proportion bar — the three buckets below sum to the total above. */}
                <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-surface-2" title={`${n(savedTotal)} saqlandi · ${n(waiting)} kutmoqda · ${n(s.noCase)} mos ish yoʻq`}>
                  {savedTotal > 0 && <div className="bg-emerald-500" style={{ width: w(savedTotal) }} />}
                  {waiting > 0 && <div className="bg-amber-400" style={{ width: w(waiting) }} />}
                  {s.noCase > 0 && <div className="bg-slate-400/50" style={{ width: w(s.noCase) }} />}
                </div>
                {/* Legend — plain-language meaning of each bucket. */}
                <div className="mt-2.5 grid gap-1">
                  {rows.map((r) => (
                    <div key={r.key} className="flex items-center gap-2 text-[11px]">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${r.dot}`} />
                      <span className={`w-32 shrink-0 font-medium ${r.tone}`}>{r.label}</span>
                      <span className={`w-10 shrink-0 text-right tabular-nums font-semibold ${r.tone}`}>{n(r.value)}</span>
                      <span className="min-w-0 flex-1 truncate text-muted" title={r.desc}>— {r.desc}</span>
                    </div>
                  ))}
                </div>

                {/* «Saqlansinmi?» — tasdiq oynasi: soni + firma boʻyicha + «topilmadi» (saqlanmaydi) */}
                {confirmSave && waiting > 0 && (
                  <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
                    <div className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-200">{n(waiting)} ta arizani bazaga saqlansinmi?</div>
                    <div className="mt-1 text-[11px] text-muted">
                      Har biri alohida imzolangan-ariza PDF qilib mijoz ishiga (case) saqlanadi — sud paketiga tayyor boʻladi.
                      {update ? ' Avval saqlangan boʻlsa, ustiga yangi skan yoziladi.' : ''}
                    </div>
                    {/* Firma boʻyicha — qaysi firmadan qanchasi saqlanadi */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.firms.filter((f) => f.withCase - f.saved > 0).map((f) => (
                        <span key={f.firm} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium">
                          <span className="max-w-[9rem] truncate" title={f.firm}>{f.firm}</span>
                          <b className="tabular-nums text-emerald-700 dark:text-emerald-300">{n(f.withCase - f.saved)}</b>
                        </span>
                      ))}
                    </div>
                    {s.noCase > 0 && (
                      <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                        <span aria-hidden>⚠</span>
                        <span><b className="tabular-nums">{n(s.noCase)}</b> ta ariza mos ish (case) topilmadi — bular <b>saqlanmaydi</b>. Roʻyxatdan «faqat ishda yoʻq» bilan koʻrib, Excel qilib olishingiz mumkin.</span>
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <button type="button" onClick={saveToDb} disabled={saving || running} aria-busy={saving || running}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm outline-none transition-colors hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-wait disabled:opacity-60">
                        {saving
                          ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                          : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>}
                        Ha, {n(waiting)} tasini saqlash
                      </button>
                      <button type="button" onClick={() => setConfirmSave(false)} disabled={saving} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-50">Bekor</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="space-y-1.5">
            {s.firms.map((f) => {
              const active = firmFilter === f.firm;
              const pending = f.withCase - f.saved;
              return (
                <button
                  key={f.firm}
                  type="button"
                  onClick={() => { setFirmFilter(active ? null : f.firm); setOpen(true); setOnlyNoCase(false); }}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${active ? 'border-violet-500/50 bg-violet-500/[0.06]' : 'border-line bg-surface hover:bg-surface-2/60'}`}
                >
                  <span className="flex-1 truncate text-[13px] font-medium" title={f.firm}>{f.firm}</span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums">{n(f.total)} ta</span>
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-300" title="alohida PDF qilib bazaga saqlangan (sudga tayyor)">{n(f.saved)} saqlandi</span>
                  {pending > 0 && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber-700 dark:text-amber-300" title="ishda bor, lekin hali bazaga saqlanmagan">{n(pending)} kutmoqda</span>
                  )}
                  {f.total - f.withCase > 0 && (
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted" title="case yoʻq (masalan sud roʻyxatida emas)">{n(f.total - f.withCase)} yoʻq</span>
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
                          <tr key={a.pinfl + a.reg} className={`border-t border-line/60 ${!a.hasCase ? 'bg-amber-500/[0.04]' : a.linked ? 'bg-emerald-500/[0.03]' : ''}`}>
                            <td className="px-2.5 py-1.5 tabular-nums text-muted">{i + 1}</td>
                            <td className="px-2.5 py-1.5">
                              <div className="font-medium">{a.name || <span className="text-muted">—</span>}</div>
                              {a.address && <div className="truncate text-[11px] text-muted" title={a.address}>{a.address}</div>}
                            </td>
                            <td className="px-2.5 py-1.5 font-mono tabular-nums text-[11px]">{a.pinfl}</td>
                            <td className="px-2.5 py-1.5 truncate" title={a.firm}>{a.firm}</td>
                            <td className="px-2.5 py-1.5">
                              {a.linked ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300" title="alohida PDF qilib bazaga saqlangan — sud paketiga tayyor">
                                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>
                                  saqlandi
                                </span>
                              ) : a.hasCase ? (
                                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300" title="ishda bor, lekin hali bazaga saqlanmagan">kutmoqda</span>
                              ) : a.hasPortfolio ? (
                                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">case yoʻq</span>
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
