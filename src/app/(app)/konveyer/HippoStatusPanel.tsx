'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';

interface Reg { id: number; name: string; total: number; delivered: number; failed: number; pending: number; draft: number }
interface OverallFirm { firmId: number; firmName: string; connected: boolean; balance: number; registries: number; sent: number }
interface Data {
  connected?: boolean; firmName?: string; balance?: number; free?: boolean; registries?: Reg[]; error?: string;
  overall?: boolean; totals?: { firmCount: number; balance: number; sent: number; registries: number }; firms?: OverallFirm[];
  checkedAt?: string;
}

const n = (x: number) => x.toLocaleString('ru-RU');
const pad = (x: number) => String(x).padStart(2, '0');
const asOf = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const REFRESH_MS = 2 * 60 * 60 * 1000; // auto-refresh every 2 hours

function Bar({ r }: { r: Reg }) {
  const t = Math.max(1, r.total);
  const seg = (v: number, c: string) => (v > 0 ? <div className={c} style={{ width: `${(v / t) * 100}%` }} /> : null);
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      {seg(r.delivered, 'bg-emerald-500')}
      {seg(r.pending, 'bg-amber-500')}
      {seg(r.failed, 'bg-rose-500')}
    </div>
  );
}

export function HippoStatusPanel({ firmId }: { firmId?: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true); // hold the skeleton box from the first paint
  const [err, setErr] = useState<string | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null); // download errors stay inline, never nuke the list
  const [dlBusy, setDlBusy] = useState<number | null>(null);
  const reqId = useRef(0);
  // Blank stale data the instant the firm changes so the prior firm's numbers
  // never linger while the new firm loads.
  useEffect(() => { setData(null); }, [firmId]);

  const downloadReceipts = async (registryId: number) => {
    if (!firmId) return;
    setDlBusy(registryId); setDlErr(null);
    try {
      const res = await fetch(`/konveyer/hippo/receipts?firmId=${firmId}&registryId=${registryId}`);
      if (!res.ok) { let e = 'Yuklab bo‘lmadi'; try { e = (await res.json()).error || e; } catch {} throw new Error(e); }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = m ? decodeURIComponent(m[1]) : 'kvitansiya.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setDlErr(e instanceof Error ? e.message : 'Kvitansiya yuklab bo‘lmadi'); } // inline, keeps the list
    finally { setDlBusy(null); }
  };

  const load = useCallback(async () => {
    const my = ++reqId.current; // ignore this response if a newer firm was selected
    setLoading(true); setErr(null);
    try {
      // No firm → overall aggregate (never empty); a firm → its detailed status.
      const res = await fetch(`/konveyer/hippo/status${firmId ? `?firmId=${firmId}` : ''}`, { cache: 'no-store' });
      if (my !== reqId.current) return;
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      setData(await res.json());
    } catch (e) { if (my === reqId.current) setErr(e instanceof Error ? e.message : 'Yuklab bo‘lmadi'); }
    finally { if (my === reqId.current) setLoading(false); }
  }, [firmId]);
  useEffect(() => { load(); }, [load]);
  // Auto-refresh every 2h so the "as of" data doesn't go stale unattended.
  useEffect(() => { const id = setInterval(() => load(), REFRESH_MS); return () => clearInterval(id); }, [load]);

  const totals = (data?.registries ?? []).reduce((a, r) => ({ d: a.d + r.delivered, p: a.p + r.pending, f: a.f + r.failed, t: a.t + r.total }), { d: 0, p: 0, f: 0, t: 0 });

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Talabnoma — xat.hippo</div>
          <div className="mt-0.5 text-xs text-muted">
            Yuborilgan reyestrlar va yetkazilish holati
            {data?.checkedAt ? <span className="tabular-nums"> · ma'lumot: {asOf(data.checkedAt)} holatiga</span> : ' (jonli)'}
          </div>
        </div>
        <button onClick={load} disabled={loading} aria-busy={loading} title="Qo'lda yangilash (aks holda har 2 soatda avto)" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted outline-none transition-colors hover:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50">
          {loading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
          Yangilash
        </button>
      </div>

      {/* A failed refresh (or receipt download) shows a small inline strip and keeps
          the already-loaded list — it never replaces the whole panel. */}
      {((err && data) || dlErr) && (
        <div role="alert" className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-2.5 py-1.5 text-[11px]">
          <span className="text-rose-500">{dlErr || err}</span>
          <button onClick={() => { setDlErr(null); if (err) load(); }} className="rounded border border-line px-1.5 py-0.5 font-medium text-muted hover:border-brand-500/40">Qayta</button>
        </div>
      )}
      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />)}</div>
      ) : err && !data ? (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-xs">
          <span className="text-rose-500">{err}</span>
          <button onClick={load} className="rounded border border-line px-2 py-0.5 font-medium text-muted hover:border-brand-500/40">Qayta</button>
        </div>
      ) : data?.overall ? (
        (data.totals?.firmCount ?? 0) > 0 ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-lg bg-surface-2 px-2 py-1 font-medium tabular-nums">{n(data.totals!.firmCount)} firma ulangan</span>
              <span className="rounded-lg bg-surface-2 px-2 py-1 font-medium tabular-nums">Jami balans: {n(data.totals!.balance)} so‘m</span>
              <span className="rounded-lg bg-emerald-500/12 px-2 py-1 font-medium text-emerald-700 tabular-nums dark:text-emerald-300">Jami yuborilgan: {n(data.totals!.sent)}</span>
              <span className="rounded-lg bg-surface-2 px-2 py-1 font-medium tabular-nums text-muted">{n(data.totals!.registries)} reyestr</span>
            </div>
            <ul className="space-y-1.5">
              {(data.firms ?? []).filter((f) => f.connected).map((f) => (
                <li key={f.firmId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2 text-xs">
                  <span className="min-w-[7rem] flex-1 truncate font-medium" title={f.firmName}>{f.firmName}</span>
                  <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 tabular-nums">
                    <span className="text-muted">{n(f.balance)} so‘m</span>
                    <span className="text-emerald-600 dark:text-emerald-400">{n(f.sent)} yuborilgan</span>
                    <span className="text-muted">{n(f.registries)} reyestr</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[11px] text-muted">Batafsil (yetkazilgan / kutilmoqda / kvitansiya) uchun yuqoridan firmani tanlang.</div>
          </>
        ) : (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">Hali birorta firma xat.hippo ga ulanmagan. Yuqoridagi ulanish belgisidan «Ula» bosing.</div>
        )
      ) : data && !data.connected ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          {data.error || 'Bu firma xat.hippo ga ulanmagan.'} Yuqoridagi ulanish belgisidan «Ula» bosing.
        </div>
      ) : data ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-lg bg-surface-2 px-2 py-1 font-medium tabular-nums">Balans: {n(data.balance ?? 0)} so‘m{data.free ? ' · bepul tarif' : ''}</span>
            <span className="rounded-lg bg-emerald-500/12 px-2 py-1 font-medium text-emerald-700 tabular-nums dark:text-emerald-300">Yetkazilgan {n(totals.d)}</span>
            <span className="rounded-lg bg-amber-500/12 px-2 py-1 font-medium text-amber-700 tabular-nums dark:text-amber-300">Kutilmoqda {n(totals.p)}</span>
            <span className="rounded-lg bg-rose-500/12 px-2 py-1 font-medium text-rose-600 tabular-nums dark:text-rose-300">Muvaffaqiyatsiz {n(totals.f)}</span>
          </div>
          {(data.registries ?? []).length === 0 ? (
            <div className="grid h-16 place-items-center text-center text-xs text-muted">Hali reyestr yuborilmagan.</div>
          ) : (
            <ul className="space-y-2">
              {data.registries!.map((r) => (
                <li key={r.id} className="rounded-xl border border-line bg-surface px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium" title={r.name}>{r.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">{n(r.total)} ta</span>
                  </div>
                  <Bar r={r} />
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">✓ {n(r.delivered)}</span>
                    <span className="text-amber-600 dark:text-amber-400">◷ {n(r.pending)}</span>
                    <span className="text-rose-500">✕ {n(r.failed)}</span>
                    {r.draft > 0 && <span className="text-muted">qoralama {n(r.draft)}</span>}
                    {r.delivered > 0 && (
                      <button
                        onClick={() => downloadReceipts(r.id)}
                        disabled={dlBusy === r.id}
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-brand-600 outline-none transition-colors hover:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50 dark:text-brand-400"
                        title="Yetkazilgan kvitansiyalarni ZIP qilib olish (sudga isbot)"
                      >
                        {dlBusy === r.id
                          ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> Yuklanmoqda…</>
                          : <>Kvitansiya ({n(r.delivered)})</>}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
