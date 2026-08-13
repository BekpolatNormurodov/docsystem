'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ico } from '@/ui';
import { returnResultInfo } from '@/lib/court-result';

interface Row {
  pinfl: string | null; clientName: string; firmName: string; caseNumber: string | null;
  result: string; resultLabel: string; definitionDate: string | null;
  registryNumber: string | null; registryDt: string | null;
}
interface Data { total: number; byResult: Record<string, number>; returns: Row[] }

const dmy = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};
const n = (x: number) => x.toLocaleString('ru-RU');
const initials = (s: string) => (s || '—').trim().replace(/[«»"]/g, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—';

interface Ajrim { available: boolean; ajrimType: string | null; pdfName: string | null; judge: string | null; court: string | null; outgoingDate: string | null }

// ── one expandable return row: header (result + who + ajrim date) → body (LIVE ajrim + sabab + meta) ──
const ReturnCard = React.memo(function ReturnCard({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const info = returnResultInfo(r.result);
  // LIVE ajrim (cabinet.sud.uz) — lazy-fetched on first open.
  const [ajrim, setAjrim] = useState<Ajrim | null>(null);
  const [ajrimLoading, setAjrimLoading] = useState(false);
  const [ajrimErr, setAjrimErr] = useState<{ msg: string; needAuth: boolean } | null>(null);
  const fetched = useRef(false);
  useEffect(() => {
    if (!open || fetched.current || !r.caseNumber) return;
    fetched.current = true;
    setAjrimLoading(true); setAjrimErr(null);
    fetch(`/konveyer/court-return-ajrim?caseNumber=${encodeURIComponent(r.caseNumber)}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { setAjrimErr({ msg: d?.error || 'Ajrim olinmadi', needAuth: !!d?.needAuth }); return; }
        setAjrim(d);
      })
      .catch(() => setAjrimErr({ msg: 'Tarmoq xatosi', needAuth: false }))
      .finally(() => setAjrimLoading(false));
  }, [open, r.caseNumber]);
  return (
    <div className="rounded-xl border border-line bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/30">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${info.chip}`} aria-hidden>{initials(r.clientName)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{r.clientName}</span>
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${info.chip}`}>{info.label}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            {r.pinfl && <span className="font-mono tabular-nums">{r.pinfl}</span>}
            <span className="max-w-[12rem] truncate rounded bg-surface-2 px-1.5 py-0.5 font-medium" title={r.firmName}>{r.firmName}</span>
            {r.caseNumber && <span className="font-mono tabular-nums">{r.caseNumber}</span>}
          </div>
        </div>
        {r.definitionDate && (
          <span className="hidden shrink-0 text-right text-[11px] text-muted sm:block">
            <span className="block text-[10px] uppercase tracking-wide opacity-70">Ajrim</span>
            <span className="tabular-nums">{dmy(r.definitionDate)}</span>
          </span>
        )}
        <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line bg-surface-2/30 p-3">
          {/* LIVE sud ajrimi (cabinet.sud.uz) — real ajrim turi + sudya + sud + PDF (aniq sabab shu hujjatda) */}
          <div className="rounded-lg border border-brand-500/25 bg-brand-500/[0.04] px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <Ico.judge size={14} className="text-brand-500" /> Sud ajrimi (cabinet.sud.uz)
            </div>
            {ajrimLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-muted"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500/40 border-t-brand-500" /> Ajrim olinmoqda…</div>
            ) : ajrimErr ? (
              <div className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">{ajrimErr.msg}</div>
            ) : ajrim ? (
              <div className="space-y-1.5">
                {ajrim.ajrimType && <div className="text-[13px] font-semibold">{ajrim.ajrimType}</div>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                  {ajrim.judge && <span>Sudya: <b className="font-medium text-fg">{ajrim.judge}</b></span>}
                  {ajrim.court && <span>{ajrim.court}</span>}
                </div>
                {ajrim.available ? (
                  <a
                    href={`/konveyer/court-return-ajrim/download?caseNumber=${encodeURIComponent(r.caseNumber ?? '')}`}
                    target="_blank" rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-brand-700 outline-none transition-colors hover:bg-brand-500/15 focus-visible:ring-2 focus-visible:ring-brand-500/30 dark:text-brand-300"
                  >
                    <Ico.download size={14} /> Ajrimni ochish (PDF)
                  </a>
                ) : (
                  <div className="text-[12px] text-muted">Ajrim PDF hali mavjud emas.</div>
                )}
                <div className="text-[11px] text-muted">Kamchilikning aniq matni shu ajrim ichida yozilgan.</div>
              </div>
            ) : (
              <div className="text-[12px] text-muted">Ajrim maʼlumoti yoʻq.</div>
            )}
          </div>

          {/* Asosiy sabab — standard meaning of THIS outcome + recommended next action */}
          <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${info.chip}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${info.dot}`} aria-hidden /> {info.label}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Asosiy sabab</span>
            </div>
            <p className="text-[12px] leading-relaxed">{info.what}</p>
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-fg">
              <Ico.info size={14} className="mt-0.5 shrink-0 text-brand-500" />
              <span><b className="font-semibold">Tavsiya:</b> {info.action}</span>
            </p>
          </div>

          {/* structured detail we DO have from cabinet */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Meta label="Ish raqami" value={r.caseNumber} mono />
            <Meta label="Registratsiya №" value={r.registryNumber} mono />
            <Meta label="Ajrim sanasi" value={dmy(r.definitionDate)} />
            <Meta label="Ro‘yxatga olingan" value={dmy(r.registryDt)} />
          </div>

          <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
            <Ico.info size={13} className="mt-0.5 shrink-0" />
            <span>Aniq izoh (kamchilik matni) — <b className="font-medium text-fg">cabinet.sud.uz</b> dagi ajrimda. Ish raqami bo‘yicha «Mening ishlarim» → ajrimni oching. Tuzatib qayta topshirish ham o‘sha yerda.</span>
          </div>
        </div>
      )}
    </div>
  );
});

function Meta({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-[12px] font-medium ${mono ? 'font-mono tabular-nums' : ''}`} title={value ?? ''}>{value || '—'}</div>
    </div>
  );
}

// «Suddan qaytgan ishlar» — clients the court RETURNED/REFUSED/UNCONSIDERED (cabinet.sud.uz outcome),
// to fix & re-file. Single compact view: colored result filters + search + expandable per-case reason.
// Re-submission itself is done on cabinet.sud.uz (blocked here on purpose).
export function CabinetReturns({ snapshotId, firmId }: { snapshotId?: number; firmId?: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [xlsBusy, setXlsBusy] = useState(false);
  const [resultF, setResultF] = useState<string>('all');
  const [q, setQ] = useState('');
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    setLoading(true); setErr(null);
    try {
      const p = new URLSearchParams();
      if (snapshotId != null) p.set('s', String(snapshotId));
      if (firmId != null) p.set('firmId', String(firmId));
      const res = await fetch(`/konveyer/court-returns?${p.toString()}`);
      if (my !== reqRef.current) return;
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      setData(await res.json());
    } catch (e) { if (my === reqRef.current) setErr(e instanceof Error ? e.message : 'Yuklanmadi'); }
    finally { if (my === reqRef.current) setLoading(false); }
  }, [snapshotId, firmId]);
  useEffect(() => { load(); }, [load]);

  const downloadExcel = async () => {
    setXlsBusy(true);
    try {
      const p = new URLSearchParams();
      if (snapshotId != null) p.set('s', String(snapshotId));
      if (firmId != null) p.set('firmId', String(firmId));
      const res = await fetch(`/konveyer/court-returns-excel?${p.toString()}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'Suddan_qaytganlar.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } finally { setXlsBusy(false); }
  };

  // counts per raw result code (for the colored filter chips)
  const byCode = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of data?.returns ?? []) m[r.result] = (m[r.result] ?? 0) + 1;
    return m;
  }, [data]);
  const codes = useMemo(() => Object.keys(byCode).sort((a, b) => byCode[b] - byCode[a]), [byCode]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.returns ?? []).filter((r) => {
      if (resultF !== 'all' && r.result !== resultF) return false;
      if (needle && !`${r.clientName} ${r.pinfl ?? ''} ${r.firmName} ${r.caseNumber ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, resultF, q]);

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Suddan qaytgan ishlar (cabinet.sud.uz)</div>
          <div className="mt-0.5 text-xs text-muted">Sud arizani qaytargan/rad etgan mijozlar — har birini ochib sababi va tavsiyani ko‘ring, tuzatib qayta topshiring.</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} aria-label="Yangilash" title="Yangilash" className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50">
            <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
          </button>
          <button onClick={downloadExcel} disabled={xlsBusy || !data?.total} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-fg outline-none transition-colors hover:border-brand-500/40 hover:bg-surface-2 disabled:opacity-50">
            {xlsBusy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Ico.sheet size={15} className="text-emerald-600 dark:text-emerald-400" />} Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : err ? (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-xs text-rose-500">
          <span>{err}</span>
          <button onClick={load} className="rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">Qayta urinish</button>
        </div>
      ) : !data || data.total === 0 ? (
        <div className="grid h-16 place-items-center text-center text-xs text-muted">Qaytgan ish yoʻq.</div>
      ) : (
        <>
          {/* colored result filters (double as the summary). Active = solid fill; «Hammasi» resets. */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setResultF('all')}
              aria-pressed={resultF === 'all'}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors ${resultF === 'all' ? 'bg-brand-500 text-white shadow-sm' : 'bg-surface-2 text-muted hover:text-fg'}`}
            >
              Hammasi <span className="tabular-nums">{n(data.total)}</span>
            </button>
            {codes.map((code) => {
              const info = returnResultInfo(code);
              const active = resultF === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setResultF(active ? 'all' : code)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${active ? info.chipActive : `${info.chip} hover:brightness-95`}`}
                >
                  <span className={`h-2 w-2 rounded-full ${active ? 'bg-white/80' : info.dot}`} aria-hidden />
                  {info.label}
                  <span className="font-semibold tabular-nums">{n(byCode[code])}</span>
                </button>
              );
            })}
            {resultF !== 'all' && (
              <button onClick={() => setResultF('all')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:text-fg" title="Filterni tozalash">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                Tozalash
              </button>
            )}
          </div>

          {/* result-count line so a filtered view says how many it shows */}
          <div className="mb-2 text-[11px] text-muted">
            {resultF === 'all' ? `${n(shown.length)} ta ish` : `${n(shown.length)} ta «${returnResultInfo(resultF).label}»`}{q && ` · «${q}» bo‘yicha`}
          </div>

          {/* search */}
          <div className="relative mb-2">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Qidirish" placeholder="F.I.O, PINFL, firma yoki ish raqami…" className="w-full rounded-xl border border-line bg-surface py-2 pl-10 pr-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" />
          </div>

          {shown.length === 0 ? (
            <div className="grid h-16 place-items-center text-center text-xs text-muted">{q ? `«${q}» topilmadi` : 'Bu filtrda ish yoʻq.'}</div>
          ) : (
            <div className="max-h-[32rem] space-y-1.5 overflow-auto pr-1">
              {shown.map((r, i) => <ReturnCard key={`${r.pinfl ?? r.caseNumber ?? i}`} r={r} />)}
            </div>
          )}

          <div className="mt-2 text-[11px] text-muted">Har satrni ochsangiz — cabinet.sud.uz dan <b className="font-medium text-fg">sud ajrimi</b> (turi, sudya, sud) va <b className="font-medium text-fg">ajrim PDF</b> (aniq sabab), hamda natija ma’nosi va tavsiya ko‘rinadi.</div>
        </>
      )}
    </div>
  );
}
