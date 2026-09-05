'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useConfirm, Ico } from '@/ui';

interface Reg { id: number; name: string; total: number; delivered: number; failed: number; pending: number; draft: number; createdAt?: string | null }
interface OverallFirm { firmId: number; firmName: string; connected: boolean; balance: number; registries: number; sent: number }
interface Data {
  connected?: boolean; firmName?: string; balance?: number; free?: boolean; registries?: Reg[]; error?: string;
  overall?: boolean; totals?: { firmCount: number; balance: number; sent: number; registries: number }; firms?: OverallFirm[];
  checkedAt?: string;
}

const n = (x: number) => x.toLocaleString('ru-RU');
const pad = (x: number) => String(x).padStart(2, '0');
const asOf = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const REFRESH_MS = 2 * 60 * 60 * 1000; // background live-refresh every 2 hours

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
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true); // hold the skeleton box from the first paint
  const [err, setErr] = useState<string | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null); // download errors stay inline, never nuke the list
  const [dlBusy, setDlBusy] = useState<number | null>(null);       // kvitansiya download in flight (registryId)
  const [dlLettersBusy, setDlLettersBusy] = useState<number | null>(null); // letter-PDF download in flight (registryId)
  const [cancelBusy, setCancelBusy] = useState<number | null>(null); // registry being cancelled/deleted
  const [syncBusy, setSyncBusy] = useState(false);                   // «Hippodan sinxronlash» in flight
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const reqId = useRef(0);
  // Clear on firm change so the prior firm's numbers never linger; load() immediately refills from
  // the DB cache (fast), so the blank window is a few ms — not the ~20s live hippo pull.
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

  // Download the SENT talabnoma LETTER PDFs (the letters hippo formed) of a registry as a ZIP —
  // distinct from the kvitansiya (delivery receipt). Inline errors, keeps the list.
  const downloadLetters = async (registryId: number) => {
    if (!firmId) return;
    setDlLettersBusy(registryId); setDlErr(null);
    try {
      const res = await fetch(`/konveyer/hippo/letters?firmId=${firmId}&registryId=${registryId}`);
      if (!res.ok) { let e = 'Yuklab bo‘lmadi'; try { e = (await res.json()).error || e; } catch {} throw new Error(e); }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = m ? decodeURIComponent(m[1]) : 'talabnoma.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setDlErr(e instanceof Error ? e.message : 'Talabnomalar yuklab bo‘lmadi'); }
    finally { setDlLettersBusy(null); }
  };

  // «Bekor qilish» — delete a reyestr on xat.hippo (a draft you no longer want, or a whole batch you
  // sent by mistake). The server also drops the «iz», so those clients become re-sendable.
  const cancelRegistry = async (registryId: number) => {
    if (!firmId) return;
    const ok = await confirm({
      title: 'Reyestrni bekor qilish',
      description: 'Reyestr xat.hippo dan oʻchiriladi. Uning mijozlari qayta joʻnatishga ochiladi.',
      confirmLabel: 'Oʻchirish', danger: true,
    });
    if (!ok) return;
    setCancelBusy(registryId); setDlErr(null);
    try {
      const res = await fetch('/konveyer/hippo/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, registryId }),
      });
      if (!res.ok) { let e = 'Bekor qilib boʻlmadi'; try { e = (await res.json()).error || e; } catch {} throw new Error(e); }
      window.dispatchEvent(new CustomEvent('hippo:refresh')); // update the talabnoma summary (remaining count)
      await load();
    } catch (e) { setDlErr(e instanceof Error ? e.message : 'Bekor qilib boʻlmadi'); }
    finally { setCancelBusy(null); }
  };

  const load = useCallback(async () => {
    const my = ++reqId.current; // ignore responses if a newer firm was selected
    // 1) Instant: the DB-cached snapshot (no hippo call). Fills the panel in a few ms.
    try {
      const res = await fetch(`/konveyer/hippo/status${firmId ? `?firmId=${firmId}` : ''}`);
      if (my !== reqId.current) return;
      if (res.ok) { const d = await res.json(); if (d && !d.empty) setData(d); }
    } catch { /* cache miss — the live refresh below fills it */ }
    // 2) Live refresh from xat.hippo → recomputes, re-writes the cache, updates the view.
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/konveyer/hippo/status?refresh=1${firmId ? `&firmId=${firmId}` : ''}`, { cache: 'no-store' });
      if (my !== reqId.current) return;
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      setData(await res.json());
    } catch (e) { if (my === reqId.current) setErr(e instanceof Error ? e.message : 'Yuklab bo‘lmadi'); }
    finally { if (my === reqId.current) setLoading(false); }
  }, [firmId]);
  useEffect(() => { load(); }, [load]);
  // Auto-refresh every 2h so the "as of" data doesn't go stale unattended.
  useEffect(() => { const id = setInterval(() => load(), REFRESH_MS); return () => clearInterval(id); }, [load]);
  // Reload the instant a send/cancel happens elsewhere (TalabnomaBulk) so a new reyestr / qoralama shows.
  useEffect(() => {
    const onR = () => load();
    window.addEventListener('hippo:refresh', onR);
    return () => window.removeEventListener('hippo:refresh', onR);
  }, [load]);

  // «Hippodan sinxronlash» — pull the firm's existing hippo reyestrs (incl. the lawyers' manual sends)
  // into ClientCaseStatus so the talabnoma dedupe knows who was already sent. Read-only; nothing is sent.
  const syncHippo = async () => {
    if (!firmId || syncBusy) return;
    setSyncBusy(true); setDlErr(null); setSyncMsg(null);
    try {
      const res = await fetch('/konveyer/hippo/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firmId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) throw new Error(d?.error || 'Sinxronlab boʻlmadi');
      setSyncMsg(`${n(d.matched ?? 0)} / ${n(d.totalMails ?? 0)} ta hippodan olindi — dedupe yangilandi`);
      window.dispatchEvent(new CustomEvent('hippo:refresh')); // refreshes this panel + the talabnoma summary
    } catch (e) { setDlErr(e instanceof Error ? e.message : 'Sinxronlab boʻlmadi'); }
    finally { setSyncBusy(false); }
  };

  // «Kvitansiyalarni biriktirish» — talabnoma UZPOST cheklarini (kvitansiya) xat.hippo'dan yuklab,
  // har mijoz case'iga biriktiradi. Bir chaqiruvda 100 tagacha; qolgani bo'lsa qayta bosiladi.
  const [attachBusy, setAttachBusy] = useState(false);
  const attachReceipts = async () => {
    if (!firmId || attachBusy) return;
    setAttachBusy(true); setDlErr(null); setSyncMsg(null);
    try {
      const res = await fetch('/konveyer/hippo/attach-receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firmId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) throw new Error(d?.error || 'Biriktirib boʻlmadi');
      setSyncMsg(`+${n(d.attached ?? 0)} kvitansiya biriktirildi${d.remaining ? ` · yana ${n(d.remaining)} qoldi (qayta bosing)` : ''}${d.failed ? ` · ${n(d.failed)} xato` : ''}`);
      window.dispatchEvent(new CustomEvent('hippo:refresh'));
    } catch (e) { setDlErr(e instanceof Error ? e.message : 'Biriktirib boʻlmadi'); }
    finally { setAttachBusy(false); }
  };

  const totals = (data?.registries ?? []).reduce((a, r) => ({ d: a.d + r.delivered, p: a.p + r.pending, f: a.f + r.failed, t: a.t + r.total }), { d: 0, p: 0, f: 0, t: 0 });

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Talabnoma — xat.hippo</div>
          <div className="mt-0.5 text-xs text-muted">
            Yuborilgan reyestrlar va yetkazilish holati
            {data?.checkedAt && <span className="tabular-nums"> · {asOf(data.checkedAt)} holatiga</span>}
            {loading && data && (
              <span className="ml-1.5 inline-flex items-center gap-1 font-medium text-brand-600 dark:text-brand-400">
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> xat.hippo dan yangilanyapti…
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {firmId ? (
            <button onClick={syncHippo} disabled={syncBusy} aria-busy={syncBusy} title="xat.hippo dagi mavjud reyestrlarni (yuristlar qo'lda yuborganlar ham) tortib olish — dedupe/sanoq uchun" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted outline-none transition-colors hover:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50">
              {syncBusy
                ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                : <Ico.refresh size={14} />}
              Sinxronlash
            </button>
          ) : null}
          {firmId ? (
            <button onClick={attachReceipts} disabled={attachBusy} aria-busy={attachBusy} title="Talabnoma cheklarini (UZPOST kvitansiya) xat.hippo'dan yuklab, har mijoz ishiga biriktirish — sudga ketadi" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted outline-none transition-colors hover:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50">
              {attachBusy
                ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>}
              Cheklarni biriktirish
            </button>
          ) : null}
          <button onClick={load} disabled={loading} aria-busy={loading} title="Qo'lda yangilash (aks holda har 2 soatda avto)" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted outline-none transition-colors hover:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50">
            {loading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
            Yangilash
          </button>
        </div>
      </div>

      {syncMsg && (
        <div role="status" className="mb-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          {syncMsg}
        </div>
      )}

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
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface-2/30 px-4 py-8 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-muted">
                <Ico.send size={20} />
              </span>
              <div className="text-sm font-medium text-fg">Hali reyestr yuborilmagan</div>
              <div className="max-w-[22rem] text-xs text-muted">Yuqoridagi «Hammasini yuborish» tugmasi bilan talabnomani xat.hippo ga yuklang — yuborilgan reyestrlar shu yerda holati bilan chiqadi.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {data.registries!.map((r) => (
                <div key={r.id} className="rounded-xl border border-line bg-surface px-3 py-2">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-semibold" title={r.name}>{r.name}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted">{r.createdAt ? asOf(r.createdAt) : ''}</span>
                  </div>
                  <Bar r={r} />
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] tabular-nums">
                    <span className="text-muted">{n(r.total)}</span>
                    <span className="text-emerald-600 dark:text-emerald-400">✓{n(r.delivered)}</span>
                    <span className="text-amber-600 dark:text-amber-400">◷{n(r.pending)}</span>
                    <span className="text-rose-500">✕{n(r.failed)}</span>
                    {r.draft > 0 && <span className="rounded bg-amber-500/10 px-1 font-medium text-amber-700 dark:text-amber-300">✎{n(r.draft)}</span>}
                    <span className="ml-auto inline-flex items-center gap-1">
                      {r.total - r.draft > 0 && (
                        <button
                          onClick={() => downloadLetters(r.id)}
                          disabled={dlLettersBusy === r.id}
                          className="inline-flex items-center gap-0.5 rounded-md border border-line px-1 py-0.5 text-[10px] font-medium text-brand-600 outline-none transition-colors hover:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50 dark:text-brand-400"
                          title={`Yuborilgan talabnomalarni (PDF) ZIP qilib olish (${n(r.total - r.draft)})`}
                        >
                          {dlLettersBusy === r.id
                            ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="m9 15 3 3 3-3" /></svg>}
                          {n(r.total - r.draft)}
                        </button>
                      )}
                      {r.delivered > 0 && (
                        <button
                          onClick={() => downloadReceipts(r.id)}
                          disabled={dlBusy === r.id}
                          className="inline-flex items-center gap-0.5 rounded-md border border-line px-1 py-0.5 text-[10px] font-medium text-emerald-600 outline-none transition-colors hover:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/30 disabled:opacity-50 dark:text-emerald-400"
                          title={`Yetkazilgan kvitansiyalar ZIP — sudga isbot (${n(r.delivered)})`}
                        >
                          {dlBusy === r.id
                            ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>}
                          {n(r.delivered)}
                        </button>
                      )}
                      <button
                        onClick={() => cancelRegistry(r.id)}
                        disabled={cancelBusy === r.id}
                        className="grid h-[22px] w-[22px] place-items-center rounded-md border border-rose-500/30 text-rose-600 outline-none transition-colors hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/30 disabled:opacity-50 dark:text-rose-300"
                        title="Reyestrni bekor qilish (xat.hippo dan oʻchirish — mijozlari qayta joʻnatishga ochiladi)"
                      >
                        {cancelBusy === r.id
                          ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" /><path d="M10 11v6M14 11v6" /></svg>}
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
