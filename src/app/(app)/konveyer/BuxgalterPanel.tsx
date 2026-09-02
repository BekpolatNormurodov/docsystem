'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton, Select } from '@/ui';
import { GeneratedList } from './GeneratedList';
import { InvoiceExcelTools } from './InvoiceExcelTools';

// Per-court eligible bucket under a firm (firm→court is one-to-many).
interface CourtEligible { courtId: number; courtName: string; billingCourtId: string; billingReady: boolean; isPrimary: boolean; eligible: number }
interface FirmCourtProg { firmId: number; firmName: string; total: number; withInvoice: number; eligible: number; courts: CourtEligible[] }
interface CourtTotal { courtId: number; courtName: string; eligible: number; billingReady: boolean }
interface Batch { id: number; firmName: string; count: number; paid: number; createdAt: string }

const n = (x: number) => x.toLocaleString('ru-RU');
const dt = (iso: string) => { const d = new Date(iso); const p = (x: number) => String(x).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

interface RowProg { done: number; total: number; ok: number; failed: number; phase: string; pauseLeftMs: number; error?: string }

// Bir paketda ko'pi bilan shuncha — backend MAX_COUNT (invoice-rest.ts) bilan mos.
const ROW_CAP = 300;

/**
 * One (firm × court) invoice row: creates HAQIQIY billing boji kvitansiyalarini shu sudga
 * yo'naltirilgan kvitansiyasiz case'larga — payload o'sha sudning billing «Sud id»sidan quriladi.
 * Jonli progress + reload'da tiklanadi (localStorage). courtId POST'ga qo'shiladi.
 */
function CourtInvoiceRow({ firmId, court, snapshotId, amount, onDone }: { firmId: number; court: CourtEligible; snapshotId?: number; amount: number; onDone: () => void }) {
  const cap = Math.min(ROW_CAP, court.eligible);
  const [count, setCount] = useState<number>(cap || 0);
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [restId, setRestId] = useState<string | null>(null);
  const [prog, setProg] = useState<RowProg | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const LS_KEY = `konv_inv_batch_${firmId}_${court.courtId}`;

  const downloadZip = (rid: string) => {
    const a = document.createElement('a');
    a.href = `/api/invoices/batch/${rid}/zip`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  useEffect(() => { setCount((c) => Math.min(c, cap) || cap); }, [court.eligible]); // eslint-disable-line react-hooks/exhaustive-deps

  const poll = (restBatchId: string) => {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const res = await fetch(`/api/invoices/batch/${restBatchId}`);
      if (!res.ok) return;
      const p: RowProg = await res.json();
      setProg(p);
      if ((p.phase === 'DONE' || p.phase === 'BLOCKED' || p.phase === 'CANCELED') && timer.current) {
        clearInterval(timer.current);
        localStorage.removeItem(LS_KEY);
        setBusy(false);
        if (p.phase === 'BLOCKED') { setOk(false); setMsg(p.error ?? 'Jarayon uzildi — qayta urinib koʻring'); }
        else if (p.phase === 'CANCELED') {
          setOk(true);
          setMsg(`Bekor qilindi — ${n(p.ok)} ta yaratilgan${p.failed ? ` · ${n(p.failed)} uzildi` : ''}`);
          if (p.ok > 0) downloadZip(restBatchId);
        } else {
          setOk(true);
          setMsg(`${n(p.ok)} ta yaratildi${p.failed ? ` · ${n(p.failed)} uzildi (qayta urinib koʻring)` : ''}`);
          if (p.ok > 0) downloadZip(restBatchId);
        }
        onDone();
      }
    }, 1500);
  };

  useEffect(() => {
    let alive = true;
    const raw = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (raw) {
      (async () => {
        let saved: { r: string; i: number | null };
        try { saved = JSON.parse(raw); } catch { localStorage.removeItem(LS_KEY); return; }
        const res = await fetch(`/api/invoices/batch/${saved.r}`);
        if (!alive) return;
        if (!res.ok) { localStorage.removeItem(LS_KEY); return; }
        const p: RowProg = await res.json();
        if (!alive) return;
        setProg(p); setBatchId(saved.i ?? null); setRestId(saved.r);
        if (p.phase === 'RUNNING' || p.phase === 'PAUSING') { setBusy(true); poll(saved.r); }
        else {
          localStorage.removeItem(LS_KEY);
          if (p.phase === 'BLOCKED') { setOk(false); setMsg(p.error ?? 'Jarayon uzildi — qayta urinib koʻring'); }
          else if (p.phase === 'CANCELED') { setOk(true); setMsg(`Bekor qilindi — ${n(p.ok)} ta yaratilgan`); }
          else if (p.ok > 0) { setOk(true); setMsg(`${n(p.ok)} ta yaratildi${p.failed ? ` · ${n(p.failed)} uzildi` : ''}`); }
        }
      })();
    }
    return () => { alive = false; if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!count || count > cap) { setOk(false); setMsg(`1–${n(cap)} oraligʻida son kiriting`); return; }
    setBusy(true); setCanceling(false); setMsg(null); setProg(null); setBatchId(null); setRestId(null);
    try {
      const res = await fetch('/konveyer/invoice-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, count, s: snapshotId, courtId: court.courtId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Xato');
      setBatchId(data.invoiceBatchId ?? null);
      if (data.restBatchId) {
        setRestId(data.restBatchId);
        localStorage.setItem(LS_KEY, JSON.stringify({ r: data.restBatchId, i: data.invoiceBatchId ?? null }));
        poll(data.restBatchId);
      } else { setBusy(false); setOk(true); setMsg('Yaratildi'); onDone(); }
    } catch (e: any) { setOk(false); setBusy(false); setMsg(e?.message ?? 'Xato'); }
  };

  const cancel = async () => {
    if (!restId || canceling) return;
    setCanceling(true);
    try { await fetch(`/api/invoices/batch/${restId}`, { method: 'DELETE' }); } catch { /* poll still finalizes */ }
  };

  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold">
          {court.isPrimary && <span title="Asosiy sud" className="text-amber-500">★</span>}
          <span className="truncate">{court.courtName}</span>
        </span>
        <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{n(court.eligible)} kutyapti</span>
      </div>

      {!court.billingReady && (
        <div className="mt-1 flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
          <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4M12 17h.01" /></svg>
          «Sud id» yo'q — «Sudlar» bo'limida kiriting (aks holda invoice noto'g'ri sudga ketadi)
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {/* Soni — pro dropdown (25/50/100/Hammasi) */}
        <Select
          value={String(count)} label={`${court.courtName} invoice soni`} searchAfter={99} className="w-44 shrink-0"
          options={(() => { const o = [25, 50, 100, 200, 300].filter((v) => v <= cap); if (cap > 0 && !o.includes(cap)) o.push(cap); return o.map((v) => ({ value: String(v), label: v === cap ? `Hammasi (${n(v)})` : `${v} ta` })); })()}
          onChange={(v) => setCount(Number(v) || cap)}
        />
        <span className="text-[11px] tabular-nums text-muted">= <span className="font-semibold text-fg">{n(count * amount)}</span> soʻm</span>
        {busy && restId && (
          <button onClick={cancel} disabled={canceling} className="ml-auto inline-flex items-center gap-1 rounded-md border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-600 transition-colors hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-300">
            {canceling ? 'Toʻxtatilmoqda…' : 'Bekor'}
          </button>
        )}
        <button onClick={create} disabled={busy || !count} aria-busy={busy} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50">
          {busy ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {prog ? `${n(prog.done)}/${n(prog.total)}` : '…'}</> : 'Yarat'}
        </button>
      </div>

      {busy && prog && (
        <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums text-muted">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }} />
          </div>
          <span><span className="text-emerald-600 dark:text-emerald-400">✓{n(prog.ok)}</span>{prog.failed ? <span className="text-rose-500"> ✗{n(prog.failed)}</span> : null}</span>
          <span>{prog.phase === 'PAUSING' ? `⏸ ${Math.ceil(prog.pauseLeftMs / 1000)}s` : 'ishlayapti'}</span>
        </div>
      )}
      {msg && (
        ok ? (
          <div role="status" className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-400">
            <span>{msg}</span>
            {restId && (
              <a href={`/api/invoices/batch/${restId}/zip`} className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-700 hover:border-emerald-500/50 dark:text-emerald-300">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /></svg>
                PDF (ZIP)
              </a>
            )}
            {batchId && <a href={`/konveyer/farmoyish?batchId=${batchId}`} className="rounded border border-line px-1.5 py-0.5 font-medium text-brand-600 hover:border-brand-500/40 dark:text-brand-400">Farmoyish</a>}
          </div>
        ) : (
          <div role="alert" className="mt-1 text-[11px] font-medium text-rose-500">{msg}</div>
        )
      )}
    </div>
  );
}

/** A firm card: overall progress + one invoice row per court the firm routes to (one-to-many). */
function FirmCard({ f, snapshotId, onDone, amount }: { f: FirmCourtProg; snapshotId?: number; onDone: () => void; amount: number }) {
  const pct = f.total > 0 ? Math.round((f.withInvoice / f.total) * 100) : 0;
  const done = f.eligible === 0 && f.withInvoice >= f.total;
  const activeCourts = f.courts.filter((c) => c.eligible > 0);

  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-colors ${done ? 'border-emerald-500/25 bg-emerald-500/[0.03]' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold">{f.firmName}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-muted">
          <span><b className="text-fg">{n(f.withInvoice)}</b>/{n(f.total)} yaratilgan</span>
          {f.courts.length > 1 && <span className="rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:text-brand-300">{f.courts.length} sud</span>}
        </span>
      </div>
      <div className="my-2 h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full transition-all ${done ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {activeCourts.length === 0 ? (
        <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">✓ Hammasiga yaratilgan</div>
      ) : (
        <div className="space-y-2">
          {activeCourts.map((c) => (
            <CourtInvoiceRow key={c.courtId} firmId={f.firmId} court={c} snapshotId={snapshotId} amount={amount} onDone={onDone} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BuxgalterPanel({ snapshotId, firmId }: { snapshotId?: number; firmId?: number }) {
  const router = useRouter();
  const [firms, setFirms] = useState<FirmCourtProg[] | null>(null);
  const [courtTotals, setCourtTotals] = useState<CourtTotal[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [amount, setAmount] = useState(22000);
  const [open, setOpen] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqRef.current;
    setLoadErr(null);
    try {
      const qs = new URLSearchParams();
      if (snapshotId) qs.set('s', String(snapshotId));
      if (firmId) qs.set('firmId', String(firmId));
      const res = await fetch(`/konveyer/invoice-batch${qs.toString() ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const data = await res.json();
      if (myReq !== reqRef.current) return;
      setFirms(data.byCourt ?? []);
      setCourtTotals(data.courtTotals ?? []);
      setBatches(data.batches ?? []);
      setAmount(data.amount ?? 22000);
    } catch (e) {
      if (myReq !== reqRef.current) return;
      setFirms([]);
      setLoadErr(e instanceof Error ? e.message : 'Yuklab bo‘lmadi');
    }
  }, [snapshotId, firmId]);
  useEffect(() => { load(); }, [load]);

  const onDone = () => { load(); router.refresh(); };

  const totalWith = firms?.reduce((s, f) => s + f.withInvoice, 0) ?? 0;
  const totalEligible = firms?.reduce((s, f) => s + f.eligible, 0) ?? 0;
  const totalAll = firms?.reduce((s, f) => s + f.total, 0) ?? 0;

  return (
    <div className="card p-5">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <div>
          <div className="text-sm font-semibold">Invoice — buxgalteriya</div>
          <div className="mt-0.5 text-xs tabular-nums text-muted">Har biri {n(amount)} so'm · {n(totalWith)}/{n(totalAll)} yaratilgan{totalEligible > 0 && <span className="font-medium text-emerald-600 dark:text-emerald-400"> · {n(totalEligible)} kutyapti</span>}</div>
        </div>
        <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>
      {open && (
        <>
          {/* Invoice ro'yxati Excel eksport + to'lov holati import (reconcile) */}
          <InvoiceExcelTools snapshotId={snapshotId} firmId={firmId} firms={(firms ?? []).map((f) => ({ id: f.firmId, name: f.firmName }))} count={totalWith} onChanged={onDone} />

          {/* Sud bo'yicha umumiy taqsimot — «Uchtepa 400 · Yuqori Chirchiq 300 …» */}
          {courtTotals.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Sud bo'yicha:</span>
              {courtTotals.map((c) => (
                <span key={c.courtId} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2/50 px-2 py-0.5 text-[11px] font-medium">
                  <span className={c.billingReady ? '' : 'text-amber-600 dark:text-amber-400'}>{c.courtName}</span>
                  <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{n(c.eligible)}</span>
                  {!c.billingReady && <span title="Billing «Sud id» yo'q" className="text-amber-500">⚠</span>}
                </span>
              ))}
            </div>
          )}

          {loadErr ? (
            <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2.5 text-xs">
              <span className="text-rose-600 dark:text-rose-300">{loadErr}</span>
              <button onClick={() => load()} className="rounded-md border border-line px-2 py-1 font-medium text-muted hover:border-brand-500/40">Qayta urinish</button>
            </div>
          ) : firms !== null && firms.length === 0 ? (
            <div className="mt-4 grid h-24 place-items-center text-center text-xs text-muted">Bu snapshot bo‘yicha firma yo‘q</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {firms === null
                ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)
                : firms.map((f) => <FirmCard key={f.firmId} f={f} snapshotId={snapshotId} onDone={onDone} amount={amount} />)}
            </div>
          )}

          {batches.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Tarix — yaratilgan partiyalar</div>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[34rem] table-fixed text-sm">
                  <caption className="sr-only">Yaratilgan invoice partiyalar tarixi</caption>
                  <thead>
                    <tr className="border-b border-line bg-surface-2/40 text-[10px] uppercase tracking-wide text-muted">
                      <th scope="col" className="w-28 px-3 py-1.5 text-left font-semibold">Sana</th>
                      <th scope="col" className="px-3 py-1.5 text-left font-semibold">Firma</th>
                      <th scope="col" className="w-16 px-3 py-1.5 text-right font-semibold">Soni</th>
                      <th scope="col" className="w-28 px-3 py-1.5 text-right font-semibold">Holat</th>
                      <th scope="col" className="w-32 px-3 py-1.5 text-right font-semibold">Farmoyish</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {batches.map((b) => (
                      <tr key={b.id} className="hover:bg-surface-2">
                        <td className="px-3 py-2 text-xs tabular-nums text-muted">{dt(b.createdAt)}</td>
                        <td className="truncate px-3 py-2 font-medium" title={b.firmName}>{b.firmName}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums"><span className="font-semibold text-fg">{n(b.count)}</span> ta</td>
                        <td className="px-3 py-2 text-right text-xs">
                          {b.paid > 0
                            ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-600 dark:text-emerald-300 tabular-nums">{n(b.paid)} to'landi</span>
                            : <span className="text-muted">to'lanmagan</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <a href={`/konveyer/farmoyish?batchId=${b.id}`} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-line px-2 py-0.5 text-xs font-medium text-brand-600 hover:border-brand-500/40 dark:text-brand-400">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /></svg>
                            Farmoyish
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* «Yaratilgan invoyslar» — xuddi ariza/oferta dek: kim uchun yaratilgani, PINFL + kvitansiya
              + sud, qidiruv/filter, sahifalab, umumiy Excel skachat + har biriga kvitansiya (.pdf). */}
          <GeneratedList type="invoice" snapshotId={snapshotId} firmId={firmId} count={totalWith} />
        </>
      )}
    </div>
  );
}
