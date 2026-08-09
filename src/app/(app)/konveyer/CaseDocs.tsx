'use client';

import React, { useEffect, useRef, useState } from 'react';

interface UpDoc { id: number; kind: string; fileName: string; size: number }

const STAGE_ORDER = ['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];
const rk = (s: string) => STAGE_ORDER.indexOf(s);

// Packet slots — kind is the upload/download key; ready = generated/expected by
// stage. `bulk` slots (palata scans) are uploaded as one long PDF and split
// across cases, not attached one-by-one here. `gen` = system generates it.
function slots(stage: string, receipt: string | null, talabnomaSent: boolean) {
  const R = rk(stage);
  // gen:true = system auto-generates (no manual upload). ONLY the palata scan and
  // the firm-library docs are manual — everything else is system-generated.
  return [
    { name: 'Talabnoma (PDF)', tag: 'mijoz', kind: 'TALABNOMA', ready: talabnomaSent, bulk: false, gen: true },
    { name: 'Talabnoma (Excel)', tag: 'mijoz', kind: 'TALABNOMA_XLSX', ready: talabnomaSent, bulk: false, gen: true },
    { name: 'Ariza', tag: 'mijoz', kind: 'ARIZA', ready: R >= rk('ARIZA_GENERATED'), bulk: false, gen: true },
    { name: 'Invoice / kvitansiya', tag: 'mijoz', kind: 'INVOICE', ready: !!receipt, bulk: false, gen: true },
    { name: 'Imzolangan ariza (palatadan, skan)', tag: 'palata', kind: 'SIGNED_ARIZA', ready: R >= rk('SIGNED_SCANNED'), bulk: true, gen: false },
    { name: 'Guvohnoma', tag: 'firma', kind: 'GUVOHNOMA', ready: false, bulk: false, gen: false },
    { name: 'Ishonchnoma', tag: 'firma', kind: 'ISHONCHNOMA', ready: false, bulk: false, gen: false },
    { name: 'Shartnoma', tag: 'firma', kind: 'SHARTNOMA', ready: false, bulk: false, gen: false },
    { name: 'Oferta', tag: 'firma', kind: 'OFERTA', ready: false, bulk: false, gen: false },
  ];
}

// Tray-arrow icons read more clearly as "save/download" and "upload".
const DownIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /></svg>;
const UpIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 15V3" /><path d="m8 7 4-4 4 4" /></svg>;
const TrashIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" /><path d="M10 11v6M14 11v6" /></svg>;

const FIRM_KINDS = ['GUVOHNOMA', 'ISHONCHNOMA', 'SHARTNOMA', 'OFERTA'];

// Fetch a URL and trigger a browser download from the blob, so we can show a
// spinner while the server generates (a plain <a download> can't).
async function downloadFrom(url: string, init?: RequestInit): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) { let e = 'Xatolik'; try { e = (await res.json()).error || e; } catch {} return { ok: false, error: e }; }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : 'paket.zip';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Tarmoq xatosi' }; }
}

const BoltIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /></svg>;
const CheckIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>;
const ClockIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const SparkIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></svg>;
const EmptyIcon = () => <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M6 12h12" /></svg>;

// Per-row state → the leading tile is the bor/yo'q indicator (no text pill).
const STATE_UI: Record<string, { tile: string; label: string; Icon: () => React.JSX.Element }> = {
  have:    { tile: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', label: 'bor',    Icon: CheckIcon },
  auto:    { tile: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',             label: 'avto',   Icon: SparkIcon },
  pending: { tile: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',       label: 'kutish', Icon: ClockIcon },
  missing: { tile: 'bg-surface-2 text-muted/60',                               label: "yo'q",   Icon: EmptyIcon },
};

export function CaseDocs({ caseId, firmId, stage, receiptNumber, talabnomaSent }: { caseId: number; firmId: number; stage: string; receiptNumber: string | null; talabnomaSent: boolean }) {
  const [docs, setDocs] = useState<UpDoc[]>([]);
  const [firmLib, setFirmLib] = useState<{ id: number; kind: string }[]>([]);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [dlBusy, setDlBusy] = useState<string | null>(null); // kind currently downloading (auto-gen)
  const [rowErr, setRowErr] = useState<string | null>(null); // kind that failed its action
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<string>('BOSHQA');
  const reqRef = useRef(0); // out-of-order guard: a stale caseId's response must not overwrite

  // token defaults to the current request; the mount effect bumps it so an
  // in-flight fetch for a previous caseId/firmId can't write this row's state.
  const load = async (token = reqRef.current) => {
    try {
      const res = await fetch(`/konveyer/upload?caseId=${caseId}`);
      if (!res.ok) throw new Error('load');
      const data = await res.json();
      if (token !== reqRef.current) return;
      setDocs(data.docs ?? []);
      setLoadErr(false);
    } catch { if (token === reqRef.current) setLoadErr(true); }
  };
  const loadFirmLib = async (token = reqRef.current) => {
    try {
      const res = await fetch(`/konveyer/firm-doc?firmId=${firmId}`);
      const data = await res.json();
      if (token !== reqRef.current) return;
      setFirmLib(data.docs ?? []);
    } catch { /* keep previous firm lib */ }
  };
  useEffect(() => {
    const my = ++reqRef.current;
    setLoading(true);
    Promise.all([load(my), loadFirmLib(my)]).finally(() => { if (my === reqRef.current) setLoading(false); });
    /* eslint-disable-next-line */
  }, [caseId, firmId]);

  const pickFor = (kind: string) => { pendingKind.current = kind; fileRef.current?.click(); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const kind = pendingKind.current;
    const isFirm = FIRM_KINDS.includes(kind);
    setBusyKind(kind); setRowErr(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      let res: Response;
      if (isFirm) {
        fd.set('firmId', String(firmId)); fd.set('kind', kind);
        res = await fetch('/konveyer/firm-doc', { method: 'POST', body: fd });
      } else {
        fd.set('caseId', String(caseId)); fd.set('kind', kind);
        res = await fetch('/konveyer/upload', { method: 'POST', body: fd });
      }
      if (!res.ok) throw new Error('upload');
      if (isFirm) await loadFirmLib(); else await load();
    } catch {
      setRowErr(kind); // row shows "· xato"
    } finally {
      if (fileRef.current) fileRef.current.value = ''; // reset so re-picking the same file fires onChange
      setBusyKind(null);
    }
  };

  const del = async (id: number, kind: string) => {
    setRowErr(null);
    try {
      const res = await fetch(`/konveyer/upload?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('del');
      setDocs((d) => d.filter((x) => x.id !== id));
    } catch { setRowErr(kind); } // keep the row, show "· xato" — don't fake a delete
  };

  const genAll = async () => {
    setGenBusy(true); setGenErr(null);
    const r = await downloadFrom(`/konveyer/gen-packet?caseId=${caseId}`);
    if (!r.ok) setGenErr(r.error || 'Xatolik'); else await load();
    setGenBusy(false);
  };

  // Auto-gen slots (Talabnoma/Ariza) render server-side and are slow — download
  // via the blob helper so the row shows a spinner instead of nothing.
  const genRow = async (kind: string, href: string) => {
    setDlBusy(kind); setRowErr(null);
    const r = await downloadFrom(href);
    if (!r.ok) setRowErr(kind);
    else await load(); // refresh state (e.g. talabnomaAt flips after generating)
    setDlBusy(null);
  };

  const byKind = (k: string) => docs.find((d) => d.kind === k);
  const firmDoc = (k: string) => firmLib.find((d) => d.kind === k);

  const all = slots(stage, receiptNumber, talabnomaSent);
  const groups = [
    { label: 'Mijoz hujjatlari', tag: 'mijoz' },
    { label: 'Palatadan', tag: 'palata' },
    { label: 'Firma kutubxonasi', tag: 'firma' },
  ];

  const uploadedCount = docs.length;

  return (
    <div className="max-w-4xl space-y-3">
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx" />

      {/* One-click: system generates the whole packet (Talabnoma xlsx+pdf, Ariza,
          firma docs, uploads) into a ZIP — like the manual folder. */}
      <button
        onClick={genAll}
        disabled={genBusy}
        aria-busy={genBusy}
        className="group flex w-full items-center gap-2.5 rounded-xl border border-brand-500/30 bg-gradient-to-r from-brand-500/10 to-brand-500/[0.03] px-3.5 py-2.5 text-left outline-none transition-all hover:border-brand-500/50 hover:from-brand-500/15 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-wait disabled:opacity-70"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500 text-white shadow-sm">
          {genBusy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <BoltIcon />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-brand-700 dark:text-brand-300">{genBusy ? 'Yaratilmoqda…' : 'Hammasini yarat'}</span>
          <span className="block text-[11px] text-muted" role={genErr ? 'alert' : undefined}>{genErr ? <span className="text-rose-500">{genErr}</span> : 'Talabnoma (Excel+PDF), Ariza, firma hujjatlari — bitta ZIP'}</span>
        </span>
        <span className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5"><DownIcon /></span>
      </button>

      {loadErr && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-rose-500">
          <span>Hujjatlar yuklanmadi</span>
          <button onClick={() => { setLoading(true); Promise.all([load(), loadFirmLib()]).finally(() => setLoading(false)); }} className="rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">Qayta urinish</button>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-line/70 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Hujjatlar paketi</span>
        <a
          href={uploadedCount > 0 ? `/konveyer/download-zip?caseId=${caseId}` : undefined}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${uploadedCount > 0 ? 'border-line text-brand-600 hover:border-brand-500/40 dark:text-brand-400' : 'pointer-events-none border-line text-muted/40'}`}
          title={uploadedCount > 0 ? 'Yuklangan hujjatlarni ZIP qilib olish' : 'Hali yuklangan hujjat yo‘q'}
        >
          <DownIcon /> Yuklangan{uploadedCount > 0 ? ` · ${uploadedCount}` : ''}
        </a>
      </div>
      {loading ? (
        // Shimmer while the case docs + firm library load — no "yo'q" flash.
        [3, 1, 4].map((cnt, gi) => (
          <div key={gi} className="rounded-xl border border-line bg-surface-2/30 p-2.5">
            <div className="mb-1.5 h-3 w-28 animate-pulse rounded bg-surface-2" />
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {Array.from({ length: cnt }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 ring-1 ring-line/60">
                  <span className="h-6 w-6 shrink-0 animate-pulse rounded-md bg-surface-2" />
                  <span className="h-3 flex-1 animate-pulse rounded bg-surface-2" />
                  <span className="h-7 w-7 shrink-0 animate-pulse rounded-md bg-surface-2" />
                </div>
              ))}
            </div>
          </div>
        ))
      ) : groups.map((g) => {
        const items = all.filter((s) => s.tag === g.tag);
        if (!items.length) return null;
        const ready = items.filter((s) => byKind(s.kind) || (FIRM_KINDS.includes(s.kind) ? !!firmDoc(s.kind) : s.ready)).length;
        const done = ready === items.length;
        return (
        <div key={g.tag} className="rounded-xl border border-line bg-surface-2/30 p-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-surface-2 text-muted'}`}>{ready}/{items.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {items.map((s) => {
          const up = byKind(s.kind);
          const busy = busyKind === s.kind;
          const isFirm = FIRM_KINDS.includes(s.kind);
          const fd = isFirm ? firmDoc(s.kind) : null;
          const genHref =
            s.kind === 'TALABNOMA' ? `/konveyer/gen-talabnoma?caseId=${caseId}`
            : s.kind === 'TALABNOMA_XLSX' ? `/konveyer/gen-talabnoma-excel?caseId=${caseId}`
            : s.kind === 'ARIZA' ? `/konveyer/gen-ariza?caseId=${caseId}`
            : s.kind === 'INVOICE' ? (receiptNumber ? `/konveyer/gen-invoice?caseId=${caseId}` : null)
            : null;
          const isAutoGen = s.gen;                         // system generates → never a manual upload
          const effReady = isFirm ? !!fd : s.ready;
          const have = !!up || !!fd || (effReady && !s.bulk);
          const state = have ? 'have' : isAutoGen ? 'auto' : s.bulk ? 'pending' : 'missing';
          const ui = STATE_UI[state];
          const dlHref = up ? `/konveyer/download?id=${up.id}` : fd ? `/konveyer/firm-doc?download=${fd.id}` : genHref;
          const canDelete = !!up;
          const canUpload = !up && (isFirm || s.bulk);     // ONLY firm library + palata scan are manual
          const stateTitle = have ? 'bor' : isAutoGen ? 'avto — system yaratadi' : s.bulk ? 'kutish — palatadan skan' : "yo'q";
          return (
            <div key={s.kind} className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1 ring-1 ring-line/60 transition-colors hover:ring-brand-500/30">
              {/* leading tile IS the bor/yo'q indicator */}
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${ui.tile}`} title={stateTitle} aria-label={stateTitle}>
                <ui.Icon />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={s.name}>{s.name}{rowErr === s.kind && <span className="ml-1 text-rose-500">· xato</span>}</span>
              {/* download slot — auto-gen rows generate server-side, so use a spinner button */}
              {isAutoGen && dlHref
                ? <button onClick={() => genRow(s.kind, dlHref)} disabled={dlBusy === s.kind} aria-label="Yuklab olish" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-brand-600 outline-none transition-colors hover:bg-brand-500/12 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50 dark:text-brand-400" title="System yaratib yuklab beradi">{dlBusy === s.kind ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <DownIcon />}</button>
                : dlHref
                  ? <a href={dlHref} aria-label="Yuklab olish" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-brand-600 outline-none transition-colors hover:bg-brand-500/12 focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-400" title="Yuklab olish"><DownIcon /></a>
                  : <span className="h-7 w-7 shrink-0" aria-hidden />}
              {canDelete
                ? <button onClick={() => del(up!.id, s.kind)} aria-label="O'chirish" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted outline-none transition-colors hover:bg-rose-500/12 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/40" title="O'chirish"><TrashIcon /></button>
                : canUpload
                  ? <button onClick={() => pickFor(s.kind)} disabled={busy} aria-label={fd ? 'Almashtirish' : 'Yuklash'} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted outline-none transition-colors hover:bg-brand-500/12 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-40" title={fd ? 'Almashtirish' : 'Yuklash'}>{busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <UpIcon />}</button>
                  : <span className="h-7 w-7 shrink-0" aria-hidden />}
            </div>
          );
        })}
          </div>
        </div>
        );
      })}
    </div>
  );
}
