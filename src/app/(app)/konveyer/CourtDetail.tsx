'use client';

import React, { useEffect, useRef, useState } from 'react';
import { courtBadge } from '@/lib/court-result';

interface CourtData {
  found: boolean;
  caseNumber?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  result?: string | null;
  definitionDate?: string | null;
  ruled?: boolean;
  claimKind?: string | null;
  instance?: string | null;
  judge?: string | null;
  hearingDate?: string | null;
  registryDt?: string | null;
  registryNumber?: string | null;
  defAddress?: string | null;
  modda?: string | null;
  ijrochi?: string | null;
  oylik?: string | null;
  caseCount?: number;
}
interface CourtDoc { id: string | null; group: string | null; label: string; signed: boolean; instance: string | null; fileId: string | null }
interface CourtDocs { found?: boolean; ajrimlar?: CourtDoc[]; docs?: CourtDoc[] }

const KIND_UZ: Record<string, string> = { DECREE: "Sud buyrugʻi", SUIT: 'Daʼvo', MATERIAL: 'Material' };
const dmy = (iso?: string | null) => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

function Field({ label, value, mono, pending }: { label: string; value?: string | null; mono?: boolean; pending?: string }) {
  if (!value && !pending) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</span>
      {value
        ? <span className={`text-[13px] font-medium text-fg ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
        : <span className="inline-flex w-fit items-center gap-1 rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />{pending}
          </span>}
    </div>
  );
}

// One court document row — opens the PDF in a new tab (streamed in-app via court-doc-download).
function DocRow({ d, url, judge }: { d: CourtDoc; url: string; judge?: boolean }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="group flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] transition-colors hover:border-sky-500/40 hover:bg-surface-2">
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${judge ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-sky-500/12 text-sky-600 dark:text-sky-400'}`}>
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" title={d.label}>{d.label}</span>
      {judge && <span className="shrink-0 rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">ajrim/qaror</span>}
      {d.signed && <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">imzolangan</span>}
      <svg className="h-3.5 w-3.5 shrink-0 text-muted transition-colors group-hover:text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M7 7h10v10" /></svg>
    </a>
  );
}

// «Sud maʼlumoti» — the court (cabinet.sud.uz) detail for a client's case: ruling, judge, hearing,
// result, article (modda) + executor (ijrochi). Lazily fetched. Fields we don't have yet are shown as
// pending («MIB API ulangach» / «sinxronlang»), so the operator sees what's missing vs. absent.
export function CourtDetail({ caseId }: { caseId: number }) {
  const [data, setData] = useState<CourtData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const reqRef = useRef(0);
  const [docs, setDocs] = useState<CourtDocs | null>(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const docReq = useRef(0);

  useEffect(() => {
    const my = ++reqRef.current;
    setLoading(true); setErr(null);
    fetch(`/konveyer/court-case?caseId=${caseId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('yuklanmadi'))))
      .then((d) => { if (my === reqRef.current) setData(d); })
      .catch(() => { if (my === reqRef.current) setErr('Sud maʼlumotini yuklab boʻlmadi'); })
      .finally(() => { if (my === reqRef.current) setLoading(false); });
  }, [caseId]);

  // Cabinet.sud.uz documents (ajrim/qaror + ariza…) — fetched via REST, opened in-app. Lazy, best-effort.
  useEffect(() => {
    const my = ++docReq.current;
    setDocsLoading(true); setDocs(null);
    fetch(`/konveyer/court-docs?caseId=${caseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (my === docReq.current && d?.found) setDocs({ ajrimlar: d.ajrimlar ?? [], docs: d.docs ?? [] }); })
      .catch(() => { /* best-effort — the detail still renders */ })
      .finally(() => { if (my === docReq.current) setDocsLoading(false); });
  }, [caseId]);

  if (loading) return <div className="h-16 animate-pulse rounded-lg bg-surface-2" />;
  if (err) return <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-[11px] text-rose-500">{err}</div>;
  if (!data) return null;

  if (!data.found) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface-2/40 px-3 py-3 text-center text-[11px] text-muted">
        Sud (cabinet.sud.uz) maʼlumoti hali olinmagan.
        {data.caseNumber && <span className="ml-1">Ish raqami: <b className="font-mono text-fg">{data.caseNumber}</b>.</span>}
        <div className="mt-0.5">«Ulanishlar» dan cabinet.sud.uz ga ulanib statuslarni sinxronlang.</div>
      </div>
    );
  }

  // Result-aware badge: a RETURNED/REFUSED outcome is rose «Ariza qaytarilgan», not green «Yakunlangan».
  const badge = courtBadge(data.status, data.statusLabel, data.result);
  const ajrimlar = docs?.ajrimlar ?? [];
  const ajrimIds = new Set(ajrimlar.map((d) => d.id));
  const otherDocs = (docs?.docs ?? []).filter((d) => !ajrimIds.has(d.id));
  const firstAjrim = ajrimlar[0];
  const dlUrl = (d: CourtDoc) => `/konveyer/court-doc-download?caseId=${caseId}&fileId=${encodeURIComponent(d.fileId ?? '')}&name=${encodeURIComponent(d.label)}`;
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Sud maʼlumoti</span>
        {badge
          ? <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${badge.tone}`} title={data.result ? `Xom natija: ${data.result}` : undefined}>{badge.label}</span>
          : <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">Jarayonda</span>}
        {(data.caseCount ?? 0) > 1 && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">{data.caseCount} ish</span>}
      </div>

      {badge?.bad && (
        <div className="mb-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.05] px-3 py-2 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
          <b className="font-semibold">Ariza suddan qaytarilgan.</b> Kamchilik/sabab matni cabinet.sud.uz dagi <b>ajrim</b>da koʻrsatiladi — bu matn cabinet API'sida yoʻq (faqat saytda ochib koʻriladi). Tuzatib qayta topshiriladi.
          {dmy(data.definitionDate) && <span> · Ajrim sanasi: <b className="font-mono">{dmy(data.definitionDate)}</b></span>}
          <a href="https://cabinet.sud.uz" target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 font-semibold underline decoration-rose-400/50 underline-offset-2 hover:decoration-rose-400">cabinet.sud.uz da ochish ↗</a>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Field label="Ish raqami" value={data.caseNumber} mono />
        <Field label="Reyestr raqami" value={data.registryNumber} mono />
        <Field label="Tur" value={data.claimKind ? (KIND_UZ[data.claimKind] ?? data.claimKind) : null} />
        <Field label="Bosqich" value={data.instance} />
        <Field label="Sudya" value={data.judge} pending="detailda yoʻq" />
        <Field label="Majlis sanasi" value={dmy(data.hearingDate)} />
        <Field label="Ro'yxatga olingan" value={dmy(data.registryDt)} />
        <Field label="Ajrim sanasi" value={dmy(data.definitionDate)} />
        <Field label="Javobgar manzili" value={data.defAddress} />
        <Field label="Modda" value={data.modda} pending="sud hujjatida" />
        <Field label="Ijrochi (davlat)" value={data.ijrochi} pending="MIB API ulangach" />
        <Field label="Oylikka qaratilgan" value={data.oylik} pending="MIB API ulangach" />
      </div>

      {/* Sud hujjatlari — ajrim/qaror (JUDGE) + ariza va boshqalar. cabinet.sud.uz REST orqali, in-app ochiladi. */}
      {(docsLoading || ajrimlar.length > 0 || otherDocs.length > 0) && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">Sud hujjatlari</div>
          {docsLoading ? (
            <div className="h-8 animate-pulse rounded-lg bg-surface-2" />
          ) : (
            <div className="flex flex-col gap-1">
              {ajrimlar.map((d) => <DocRow key={d.id} d={d} url={dlUrl(d)} judge />)}
              {otherDocs.map((d) => <DocRow key={d.id} d={d} url={dlUrl(d)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
