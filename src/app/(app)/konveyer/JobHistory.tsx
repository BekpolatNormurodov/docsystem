'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ico } from '@/ui';

interface Row {
  id: number; type: string; status: string; progress: number; total: number; message: string | null;
  hasResult: boolean; firmName: string; arizaOnly: boolean; createdAt: string; updatedAt: string;
}

const n = (x: number) => x.toLocaleString('ru-RU');
const pad = (x: number) => String(x).padStart(2, '0');
const dt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const TYPE_LABEL = (r: Row): string =>
  r.type === 'PACKET' ? (r.arizaOnly ? 'Ariza' : 'To‘liq paket')
  : r.type === 'OFERTA' ? 'Oferta'
  : r.type === 'TALABNOMA' ? 'Talabnoma PDF'
  : r.type === 'IMPORT' ? 'Import'
  : r.type;

const STATUS: Record<string, { label: string; tone: string }> = {
  DONE: { label: 'Tayyor', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  RUNNING: { label: 'Yaratilmoqda', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  PENDING: { label: 'Navbatda', tone: 'bg-slate-500/15 text-slate-600 dark:text-slate-300' },
  FAILED: { label: 'Xato', tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-300' },
};

/** Windowed page list: 1 … (cur-1) cur (cur+1) … last, with `null` marking an ellipsis gap. */
function pageWindow(cur: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const nums = new Set<number>([1, total, cur - 1, cur, cur + 1]);
  const sorted = [...nums].filter((x) => x >= 1 && x <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let prev = 0;
  for (const x of sorted) { if (x - prev > 1) out.push(null); out.push(x); prev = x; }
  return out;
}

// Client-side pager mirroring the shared <Pagination> look (this list is a live-polled fetch, not a
// URL-navigated server list, so it can't use the href-based server component).
function Pager({ page, pages, total, perPage, onPage }: { page: number; pages: number; total: number; perPage: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <p className="mt-3 text-center text-xs text-muted">{n(total)} partiya</p>;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const btn = 'grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-sm transition';
  return (
    <nav className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row" aria-label="Sahifalash">
      <p className="text-xs tabular-nums text-muted">
        <span className="font-semibold text-fg">{n(from)}</span>–<span className="font-semibold text-fg">{n(to)}</span> / {n(total)} partiya
      </p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Oldingi" className={`${btn} border-line ${page <= 1 ? 'pointer-events-none opacity-40' : 'hover:bg-surface-2'}`}>‹</button>
        {pageWindow(page, pages).map((x, i) =>
          x === null ? <span key={`gap-${i}`} className="px-1.5 text-muted">…</span> : (
            <button key={x} onClick={() => onPage(x)} aria-current={x === page ? 'page' : undefined}
              className={`${btn} tabular-nums ${x === page ? 'border-brand-600 bg-brand-600 font-semibold text-white' : 'border-line hover:bg-surface-2'}`}>{x}</button>
          ),
        )}
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Keyingi" className={`${btn} border-line ${page >= pages ? 'pointer-events-none opacity-40' : 'hover:bg-surface-2'}`}>›</button>
      </div>
    </nav>
  );
}

// «Partiyalar tarixi» — recent background batches (talabnoma PDF / ariza / oferta / import) with their
// status + a download for the finished ZIPs. Auto-refreshes while anything is still running; paginated
// `perPage` at a time (client-side, over the fetched window).
export function JobHistory({ limit = 200, perPage = 20 }: { limit?: number; perPage?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    try {
      const res = await fetch(`/api/jobs?limit=${limit}`, { cache: 'no-store' });
      if (my !== reqRef.current) return;
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const d = await res.json();
      setRows(d.jobs ?? []);
      setErr(null);
    } catch (e) { if (my === reqRef.current) setErr(e instanceof Error ? e.message : 'Yuklanmadi'); }
  }, [limit]);

  useEffect(() => { load(); }, [load]);
  // Poll while any batch is still running/queued so the status + download flip live.
  useEffect(() => {
    const anyLive = (rows ?? []).some((r) => r.status === 'RUNNING' || r.status === 'PENDING');
    if (!anyLive) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [rows, load]);

  const all = rows ?? [];
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  // A poll that shrinks the list must never strand the user on a now-empty page.
  useEffect(() => { setPage((p) => Math.min(Math.max(1, p), pages)); }, [pages]);
  const pageRows = useMemo(() => all.slice((page - 1) * perPage, page * perPage), [all, page, perPage]);

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Partiyalar tarixi</div>
          <div className="mt-0.5 text-xs text-muted">So‘nggi orqa-fon partiyalari (talabnoma PDF, ariza, oferta, import) — holati va yuklab olish.</div>
        </div>
        <button onClick={load} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-brand-500/40">Yangilash</button>
      </div>

      {err && !rows ? (
        <div role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-xs text-rose-500">{err}</div>
      ) : !rows ? (
        <div className="space-y-1.5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-surface-2" />)}</div>
      ) : all.length === 0 ? (
        <div className="grid h-16 place-items-center text-center text-xs text-muted">Hali partiya yo‘q.</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Sana</th>
                  <th className="px-3 py-2 font-medium">Tur</th>
                  <th className="px-3 py-2 font-medium">Firma</th>
                  <th className="px-3 py-2 font-medium">Soni</th>
                  <th className="px-3 py-2 font-medium">Holat</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const st = STATUS[r.status] ?? { label: r.status, tone: 'bg-surface-2 text-muted' };
                  const pct = r.total ? Math.min(100, Math.round((r.progress / r.total) * 100)) : 0;
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted tabular-nums">{dt(r.createdAt)}</td>
                      <td className="px-3 py-2 font-medium">{TYPE_LABEL(r)}</td>
                      <td className="px-3 py-2 text-xs text-muted">{r.firmName}</td>
                      <td className="px-3 py-2 text-xs tabular-nums">
                        {r.status === 'RUNNING' ? `${n(r.progress)}/${n(r.total)} · ${pct}%` : n(r.total)}
                      </td>
                      <td className="px-3 py-2"><span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${st.tone}`}>{st.label}</span></td>
                      <td className="px-3 py-2 text-right">
                        {r.status === 'DONE' && r.hasResult
                          ? <a href={`/api/export/${r.id}/download`} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-brand-600 hover:border-brand-500/40 dark:text-brand-400"><Ico.download size={13} /> Yuklab olish</a>
                          : r.status === 'FAILED' && r.message
                            ? <span className="text-[11px] text-rose-500" title={r.message}>xato</span>
                            : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} total={all.length} perPage={perPage} onPage={setPage} />
        </>
      )}
    </div>
  );
}
