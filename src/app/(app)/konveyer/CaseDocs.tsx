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
    // Talabnoma is a PDF letter per client. The Excel «reyestr» is a BULK, many-row file
    // (built per firm in the Talabnoma step) — a one-row Excel for a single person is
    // meaningless, so a case never gets its own .xlsx here.
    { name: 'Talabnoma (PDF)', tag: 'mijoz', kind: 'TALABNOMA', ready: talabnomaSent, bulk: false, gen: true },
    // Yetkazilgandan keyin xat.hippo shakllantirgan letter PDF (faqat joʻnatilgan boʻlsa koʻrsatiladi).
    ...(talabnomaSent ? [{ name: 'Talabnoma — yetkazilgan (hippo)', tag: 'mijoz', kind: 'TALABNOMA_HIPPO', ready: false, bulk: false, gen: true }] : []),
    { name: 'Ariza', tag: 'mijoz', kind: 'ARIZA', ready: R >= rk('ARIZA_GENERATED'), bulk: false, gen: true },
    // Grafik (toʻlash jadvali) is NOT part of the court packet (the sudga-yuborish export drops it),
    // so it's not listed here either — the per-client set is talabnoma/ariza/oferta/invoice + scan + firm docs.
    // Oferta is generated per CONTRACT (one per shartnoma) — system-generated on demand, NOT a firm
    // library template. The count («Oferta (N)») is filled in the render from the contract count.
    { name: 'Oferta', tag: 'mijoz', kind: 'OFERTA', ready: false, bulk: false, gen: true },
    { name: 'Invoice / kvitansiya', tag: 'mijoz', kind: 'INVOICE', ready: !!receipt, bulk: false, gen: true },
    { name: 'Imzolangan ariza (palatadan, skan)', tag: 'palata', kind: 'SIGNED_ARIZA', ready: R >= rk('SIGNED_SCANNED'), bulk: true, gen: false },
    { name: 'Guvohnoma', tag: 'firma', kind: 'GUVOHNOMA', ready: false, bulk: false, gen: false },
    { name: 'Ishonchnoma', tag: 'firma', kind: 'ISHONCHNOMA', ready: false, bulk: false, gen: false },
    { name: 'Shartnoma', tag: 'firma', kind: 'SHARTNOMA', ready: false, bulk: false, gen: false },
  ];
}

// Tray-arrow icons read more clearly as "save/download" and "upload".
const DownIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /></svg>;
const UpIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 15V3" /><path d="m8 7 4-4 4 4" /></svg>;
const TrashIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" /><path d="M10 11v6M14 11v6" /></svg>;

const FIRM_KINDS = ['GUVOHNOMA', 'ISHONCHNOMA', 'SHARTNOMA'];

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

// Per-card state → the leading tile icon and the status chip share one palette.
const STATE_UI: Record<string, { tile: string; chip: string; label: string; Icon: () => React.JSX.Element }> = {
  have:    { tile: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300', label: 'bor',    Icon: CheckIcon },
  auto:    { tile: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',             chip: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',             label: 'avto',   Icon: SparkIcon },
  pending: { tile: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',       chip: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',       label: 'kutilmoqda', Icon: ClockIcon },
  missing: { tile: 'bg-surface-2 text-muted/60',                               chip: 'bg-surface-2 text-muted',                                  label: "yo'q",   Icon: EmptyIcon },
};

const fmtSize = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

// Section header identity per group (icon + accent tile).
const GROUP_META: Record<string, { label: string; accent: string; icon: React.JSX.Element }> = {
  mijoz: {
    label: 'Mijoz hujjatlari', accent: 'bg-brand-500/12 text-brand-600 dark:text-brand-400',
    icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  },
  palata: {
    label: 'Palatadan', accent: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /></svg>,
  },
  firma: {
    label: 'Firma kutubxonasi', accent: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
    icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
  },
};

// ── Court-gate header ────────────────────────────────────────────────────────
// The 4 docs a case MUST have to go to court (mirrors flagsFor in src/lib/court-ready.ts).
// Shown at the top of the fill-modal so an operator filling a not-ready client sees at a
// glance exactly what still blocks THIS client — driven by the SAME flags the parent
// «Navbatda / Tayyor emas» chip uses, so the two can never disagree.
export interface CourtFlags { talabnoma: boolean; scan: boolean; oferta: boolean; boji: boolean }
// Invoice/«davlat boji» is intentionally NOT here — the state-fee invoice does not go to
// court (its number rides inside the ariza; the ariza stays bojisiz), so it is not a
// court-required document. The 3 docs a case must have to be filed:
const COURT_DOCS: { key: keyof CourtFlags; label: string }[] = [
  { key: 'talabnoma', label: 'Talabnoma' },
  { key: 'scan', label: 'Skan (palata)' },
  { key: 'oferta', label: 'Oferta' },
];
const MiniCheck = () => <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>;
const MiniDash = () => <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M6 12h12" /></svg>;

function CourtReadyBar({ flags }: { flags: CourtFlags }) {
  const missing = COURT_DOCS.filter((d) => !flags[d.key]);
  const ready = missing.length === 0;
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${ready ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-amber-500/30 bg-amber-500/[0.05]'}`}>
      <div className="flex items-center gap-2">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${ready ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>
          {ready ? <CheckIcon /> : <ClockIcon />}
        </span>
        <span className="text-sm font-semibold">{ready ? 'Sudga yuborishga tayyor' : `Sudga chiqishi uchun ${missing.length} ta hujjat yetishmayapti`}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {COURT_DOCS.map((d) => {
          const ok = flags[d.key];
          return (
            <span key={d.key} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${ok ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/12 text-rose-600 dark:text-rose-300'}`} title={ok ? `${d.label}: bor` : `${d.label}: yo'q`}>
              <span className="grid h-3.5 w-3.5 place-items-center">{ok ? <MiniCheck /> : <MiniDash />}</span>
              {d.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function CaseDocs({ caseId, firmId, stage, receiptNumber, talabnomaSent, onChange, courtFlags }: { caseId: number; firmId: number; stage: string; receiptNumber: string | null; talabnomaSent: boolean; onChange?: () => void; courtFlags?: CourtFlags }) {
  const [docs, setDocs] = useState<UpDoc[]>([]);
  const [contracts, setContracts] = useState(0); // shartnoma soni → «Oferta (N)»
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
      setContracts(data.contracts ?? 0);
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
      onChange?.(); // notify the parent (court readiness) that a doc changed → auto-update
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
      onChange?.();
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
    else { await load(); onChange?.(); } // refresh state (e.g. talabnomaAt flips after generating) + notify parent
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
    <div className="max-w-4xl space-y-4">
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx" />

      {/* Court-gate summary — first, so «nima yetishmayapti» is answered before the operator scrolls. */}
      {courtFlags && <CourtReadyBar flags={courtFlags} />}

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
          <span className="block text-[11px] text-muted" role={genErr ? 'alert' : undefined}>{genErr ? <span className="text-rose-500">{genErr}</span> : 'Talabnoma, Ariza, Oferta (har shartnomaga), firma hujjatlari — bitta ZIP'}</span>
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
        // Card-grid shimmer — same shape as the real content, no "yo'q" flash.
        [5, 1, 3].map((cnt, gi) => (
          <section key={gi} className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-surface-2" />
              <span className="h-3 w-32 animate-pulse rounded bg-surface-2" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: cnt }).map((_, i) => (
                <div key={i} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-start gap-2.5">
                    <span className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-surface-2" />
                    <div className="flex-1 space-y-1.5 pt-0.5">
                      <span className="block h-3 w-24 animate-pulse rounded bg-surface-2" />
                      <span className="block h-2.5 w-16 animate-pulse rounded bg-surface-2" />
                    </div>
                  </div>
                  <div className="mt-3 h-8 w-full animate-pulse rounded-lg bg-surface-2" />
                </div>
              ))}
            </div>
          </section>
        ))
      ) : groups.map((g) => {
        const meta = GROUP_META[g.tag] ?? { label: g.label, accent: 'bg-surface-2 text-muted', icon: null };
        const items = all.filter((s) => s.tag === g.tag);
        if (!items.length) return null;
        const ready = items.filter((s) => byKind(s.kind) || (FIRM_KINDS.includes(s.kind) ? !!firmDoc(s.kind) : s.ready)).length;
        const done = ready === items.length;
        const pct = Math.round((ready / items.length) * 100);
        return (
          <section key={g.tag} className="space-y-2">
            {/* group header — accent icon + label + progress */}
            <div className="flex items-center gap-2.5">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${meta.accent}`} aria-hidden>{meta.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold">{meta.label}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-surface-2 text-muted'}`}>{ready}/{items.length}</span>
                </div>
                <div className="mt-1 h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-surface-2">
                  <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${done ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>

            {/* document cards */}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((s) => {
                const up = byKind(s.kind);
                const busy = busyKind === s.kind;
                const isFirm = FIRM_KINDS.includes(s.kind);
                const fd = isFirm ? firmDoc(s.kind) : null;
                const genHref =
                  s.kind === 'TALABNOMA' ? `/konveyer/gen-talabnoma?caseId=${caseId}`
                  : s.kind === 'TALABNOMA_HIPPO' ? `/konveyer/gen-talabnoma-hippo?caseId=${caseId}`
                  : s.kind === 'ARIZA' ? `/konveyer/gen-ariza?caseId=${caseId}`
                  : s.kind === 'GRAFIK' ? `/konveyer/gen-grafik?caseId=${caseId}`
                  : s.kind === 'OFERTA' ? `/konveyer/gen-oferta?caseId=${caseId}`
                  // Real billing.sud.uz kvitansiya PDF (captured at mint) — not a generated form.
                  : s.kind === 'INVOICE' ? (receiptNumber ? `/konveyer/invoice-pdf?caseId=${caseId}` : null)
                  : null;
                const isAutoGen = s.gen;                       // system generates → never a manual upload
                const effReady = isFirm ? !!fd : s.ready;
                const have = !!up || !!fd || (effReady && !s.bulk);
                const state = have ? 'have' : isAutoGen ? 'auto' : s.bulk ? 'pending' : 'missing';
                const ui = STATE_UI[state];
                const dlHref = up ? `/konveyer/download?id=${up.id}` : fd ? `/konveyer/firm-doc?download=${fd.id}` : genHref;
                const canDelete = !!up;
                const canUpload = !up && (isFirm || s.bulk);   // ONLY firm library + palata scan are manual
                const dling = dlBusy === s.kind;
                const name = s.name + (s.kind === 'OFERTA' && contracts > 0 ? ` (${contracts})` : '');
                const subtitle = s.kind === 'INVOICE'
                  ? (have ? 'Billing PDF · sudga ketmaydi' : 'Invoice hali yaratilmagan')
                  : s.kind === 'TALABNOMA_HIPPO'
                    ? 'xat.hippo — yuborilganlik'
                    : up ? `${up.fileName}${up.size ? ` · ${fmtSize(up.size)}` : ''}`
                    : fd ? 'Yuklangan fayl'
                    : state === 'auto' ? 'Avto — system yaratadi'
                    : state === 'pending' ? 'Palatadan skan kutilmoqda'
                    : 'Hali biriktirilmagan';
                return (
                  <div key={s.kind} className="flex flex-col rounded-xl border border-line bg-surface p-3 transition-all hover:border-brand-500/40 hover:shadow-sm">
                    <div className="flex items-start gap-2.5">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ui.tile}`} aria-hidden><ui.Icon /></span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold" title={name}>{name}</div>
                        <div className="mt-0.5 truncate text-[11px] text-muted" title={subtitle}>
                          {rowErr === s.kind ? <span className="font-medium text-rose-500">Xatolik — qayta urining</span> : subtitle}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${ui.chip}`}>{ui.label}</span>
                    </div>

                    {/* footer — download (primary) + upload/delete */}
                    <div className="mt-2.5 flex items-center gap-1.5 border-t border-line/60 pt-2.5">
                      {dlHref ? (
                        isAutoGen ? (
                          <button onClick={() => genRow(s.kind, dlHref)} disabled={dling} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-[11px] font-medium text-brand-600 outline-none transition-colors hover:border-brand-500/40 hover:bg-brand-500/[0.06] focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50 dark:text-brand-400" title={have ? 'Yuklab olish' : 'System yaratib yuklab beradi'}>
                            {dling ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <DownIcon />}
                            {have ? 'Yuklab olish' : 'Yaratish'}
                          </button>
                        ) : (
                          <a href={dlHref} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-[11px] font-medium text-brand-600 outline-none transition-colors hover:border-brand-500/40 hover:bg-brand-500/[0.06] focus-visible:ring-2 focus-visible:ring-brand-500/30 dark:text-brand-400" title="Yuklab olish"><DownIcon /> Yuklab olish</a>
                        )
                      ) : (
                        <span className="flex-1 text-[11px] text-muted/70">{canUpload ? 'Fayl biriktiring →' : '—'}</span>
                      )}
                      {canDelete ? (
                        <button onClick={() => del(up!.id, s.kind)} aria-label="O'chirish" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted outline-none transition-colors hover:border-rose-500/40 hover:bg-rose-500/[0.08] hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/30" title="O'chirish"><TrashIcon /></button>
                      ) : canUpload ? (
                        <button onClick={() => pickFor(s.kind)} disabled={busy} aria-label={fd ? 'Almashtirish' : 'Yuklash'} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted outline-none transition-colors hover:border-brand-500/40 hover:bg-brand-500/[0.08] hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-40" title={fd ? 'Almashtirish' : 'Yuklash'}>{busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <UpIcon />}</button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
