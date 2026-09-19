'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico, Spinner, useConfirm } from '@/ui';
import { useT } from '@/lib/i18n/client';

// ── API shapes ──────────────────────────────────────────────────────────────
interface Run {
  id: number; kind: 'REYESTR' | 'LETTERS' | 'HIPPO'; firmCode: string | null; firmName: string | null;
  status: string; rowCount: number; personCount: number; resultPath: string | null; message: string | null;
  hippoRegistryId: string | null; createdAt: string; createdBy: string | null;
}
interface Batch {
  id: number; createdAt: string; createdBy: string | null; label: string | null; status: string; message: string | null;
  sourceFileName: string; portfolioFileName: string; candidateCount: number; qualifiedCount: number;
  processedRows: number; totalRows: number; summary: Summary | null; runs: Run[];
}
interface Summary {
  candidateCount: number; qualifiedCount: number; readyPersonCount: number; unreadyPersonCount: number;
  portfolioMatched: number; firms: { code: string; name: string; ready: boolean; personCount: number }[];
}
interface FirmBucket { code: string; name: string; ready: boolean; personCount: number; overdueSum: number }
interface FilterResult {
  qualifiedPeople: number; candidatePeople: number; readyPersonCount: number; unreadyPersonCount: number;
  firms: FirmBucket[];
}

const DEFAULT_THRESHOLD = 2_000_000;
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const fmtInt = (s: string) => (s ? Number(s).toLocaleString('ru-RU') : '');
const dt = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function jpost(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export function TalabnomaForm() {
  const t = useT();
  const confirm = useConfirm();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/talabnoma-form', { cache: 'no-store' });
    const j = await res.json().catch(() => ({ batches: [] }));
    setBatches(j.batches ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll while any batch is parsing OR any run (xatlar) is still being generated.
  useEffect(() => {
    const busy = batches.some((b) => b.status === 'PARSING' || b.runs.some((r) => r.status === 'PENDING' || r.status === 'RUNNING'));
    if (!busy) return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [batches, refresh]);

  const selected = batches.find((b) => b.id === selId) ?? null;

  const del = async (b: Batch) => {
    const ok = await confirm({
      title: t('Partiyani o‘chirish'),
      description: `«${b.label || b.sourceFileName}» ${t('va uning barcha fayllari (2 Excel, reyestr, xatlar) butunlay o‘chiriladi. Davom etilsinmi?')}`,
      confirmLabel: t('O‘chirish'), danger: true,
    });
    if (!ok) return;
    await fetch(`/api/talabnoma-form/${b.id}`, { method: 'DELETE' });
    if (selId === b.id) setSelId(null);
    await refresh();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{t('Talabnoma shakllantirish')}</h1>
            <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">{t('Alohida · stepga kirmaydi')}</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t('2 ta Excel (talabnoma manba + портфель) yuklang. Umumiy qarzdorlik 2 mln dan yuqori bo‘lganlar ajratiladi, firma bo‘yicha filtrlanadi, reyestr va xatlar tayyorlanadi.')}
          </p>
        </div>
      </header>

      <UploadCard onDone={(id) => { void refresh(); setSelId(id); }} />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <HistoryList batches={batches} loading={loading} selId={selId} onSelect={setSelId} onDelete={del} />
        {selected ? (
          <BatchPanel key={selected.id} batch={selected} confirm={confirm} onChanged={refresh} />
        ) : (
          <div className="card grid place-items-center p-10 text-sm text-muted">
            {t('Chapdan partiyani tanlang yoki yangi Excel yuklang.')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Upload ───────────────────────────────────────────────────────────────────
function UploadCard({ onDone }: { onDone: (batchId: number) => void }) {
  const t = useT();
  const [source, setSource] = useState<File | null>(null);
  const [portfolio, setPortfolio] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0); // «manabuncha yuklandi» — fayl yuklanish foizi
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!source || !portfolio) { setErr(t('Ikkala fayl ham kerak')); return; }
    setBusy(true); setPct(0);
    try {
      const fd = new FormData();
      fd.append('source', source);
      fd.append('portfolio', portfolio);
      if (label.trim()) fd.append('label', label.trim());
      // XHR — fetch upload progressni bermaydi; katta портфель uchun «manabuncha yuklandi» ko'rsatamiz.
      const j = await new Promise<{ ok: boolean; batchId?: number; error?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/talabnoma-form/upload');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => {
          let body: any = {}; try { body = JSON.parse(xhr.responseText || '{}'); } catch {}
          resolve({ ok: xhr.status >= 200 && xhr.status < 300, batchId: body.batchId, error: body.error });
        };
        xhr.onerror = () => reject(new Error(t('Tarmoq xatosi')));
        xhr.send(fd);
      });
      if (!j.ok) { setErr(j.error || t('Xatolik')); return; }
      setSource(null); setPortfolio(null); setLabel('');
      if (j.batchId) onDone(j.batchId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('Xatolik'));
    } finally { setBusy(false); setPct(0); }
  };

  const ready = !!source && !!portfolio;
  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <FileField step={1} label={t('Портфель (умумий)')} hint={t('То‘лиқ портфель — shartnoma tafsilotlari')} file={portfolio} onPick={setPortfolio} />
        <FileField step={2} label={t('Talabnoma PINFL ro‘yxati')} hint={t('Faqat PINFL ustuni (PNFL/PINFL/ПНФЛ) — qolgani portfeldan olinadi')} file={source} onPick={setSource} />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="field-label">{t('Nom (ixtiyoriy)')}</label>
          <input className="field-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('masalan: 20.08.2026')} />
        </div>
        <button className="btn-primary shrink-0" disabled={busy || !ready} onClick={submit}>
          {busy ? <Spinner size={16} /> : <Ico.filePlus size={16} />} {busy ? (pct < 100 ? `${t('Yuklanmoqda')} ${pct}%` : t('Tahlil qilinmoqda…')) : t('Yuklash va tahlil')}
        </button>
      </div>
      {busy && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand-600 transition-all duration-300 dark:bg-brand-400" style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {pct < 100 ? `${t('Fayllar yuklanmoqda')} — ${pct}%` : t('Fayllar yuklandi — tahlil boshlanmoqda…')}
          </p>
        </div>
      )}
      {err && <p className="mt-2 text-sm font-medium text-rose-600 dark:text-rose-300">{err}</p>}
    </div>
  );
}

function FileField({ step, label, hint, file, onPick }: { step: number; label: string; hint: string; file: File | null; onPick: (f: File | null) => void }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (f: File | null | undefined) => { if (f && /\.xlsx$/i.test(f.name)) onPick(f); };
  const fmt = (b: number) => (b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
  return (
    <div>
      <span className="field-label flex items-center gap-1.5">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-muted">{step}</span>
        {label}
      </span>
      <input ref={ref} type="file" accept=".xlsx" className="sr-only" onChange={(e) => { take(e.target.files?.[0]); if (ref.current) ref.current.value = ''; }} />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
        className={cx(
          'flex w-full items-center gap-3 rounded-xl border border-dashed px-3.5 py-3 text-left transition-colors',
          file
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : over
              ? 'border-brand-500 bg-brand-500/5'
              : 'border-[var(--field-line)] bg-[var(--field)] hover:border-brand-500/50',
        )}
      >
        <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', file ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-surface-2 text-muted')}>
          {file ? <Ico.check size={18} /> : <Ico.sheet size={18} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{file ? file.name : t('Fayl tanlang yoki sudrab tashlang')}</span>
          <span className="block truncate text-xs text-muted">{file ? fmt(file.size) : hint}</span>
        </span>
        {file && <Ico.check size={16} className="shrink-0 text-emerald-600 dark:text-emerald-300" />}
      </button>
    </div>
  );
}

// ── History list ──────────────────────────────────────────────────────────────
function HistoryList({ batches, loading, selId, onSelect, onDelete }: { batches: Batch[]; loading: boolean; selId: number | null; onSelect: (id: number) => void; onDelete: (b: Batch) => void }) {
  const t = useT();
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">{t('Tarix')}</div>
      {loading ? (
        <div className="grid place-items-center p-8"><Spinner /></div>
      ) : !batches.length ? (
        <p className="p-6 text-sm text-muted">{t('Hali partiya yo‘q.')}</p>
      ) : (
        <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
          {batches.map((b) => (
            <li key={b.id} className={cx('group relative transition-colors hover:bg-surface-2', selId === b.id && 'bg-surface-2')}>
              <button onClick={() => onSelect(b.id)} className="flex w-full flex-col gap-1 px-4 py-3 pr-10 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{b.label || b.sourceFileName}</span>
                  <StatusPill status={b.status} />
                </div>
                <div className="text-xs text-muted">{dt(b.createdAt)}</div>
                {b.status === 'READY' && (
                  <div className="text-xs text-muted">{n(b.qualifiedCount)} / {n(b.candidateCount)} ≥ 2mln · {b.runs.length} {t('amal')}</div>
                )}
              </button>
              <button
                onClick={() => onDelete(b)}
                title={t('O‘chirish')}
                aria-label={t('O‘chirish')}
                className="absolute right-2 top-2.5 grid h-8 w-8 place-items-center rounded-lg text-muted opacity-0 transition-opacity hover:bg-rose-500/10 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-rose-300"
              >
                <Ico.trash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const t = useT();
  const map: Record<string, string> = {
    READY: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300',
    PARSING: 'border-amber-500/30 text-amber-600 dark:text-amber-300',
    RUNNING: 'border-amber-500/30 text-amber-600 dark:text-amber-300',
    PENDING: 'border-slate-400/30 text-muted',
    DONE: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300',
    FAILED: 'border-rose-500/30 text-rose-600 dark:text-rose-300',
  };
  const label: Record<string, string> = { READY: t('Tayyor'), PARSING: t('Tahlil…'), RUNNING: t('Ishlayapti'), PENDING: t('Navbatda'), DONE: t('Tayyor'), FAILED: t('Xato') };
  return <span className={cx('badge shrink-0', map[status] ?? 'border-line text-muted')}>{label[status] ?? status}</span>;
}

// ── Batch panel ───────────────────────────────────────────────────────────────
function BatchPanel({ batch, confirm, onChanged }: { batch: Batch; confirm: ReturnType<typeof useConfirm>; onChanged: () => Promise<void> }) {
  const t = useT();
  const [opts, setOpts] = useState({ thresholdTotal: DEFAULT_THRESHOLD, perFirmMin: 0 });
  const [totalStr, setTotalStr] = useState(String(DEFAULT_THRESHOLD));
  const [perFirmStr, setPerFirmStr] = useState('0');
  const [result, setResult] = useState<FilterResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [busyFirm, setBusyFirm] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Qarzdorlik filtri — DEFAULT O'CHIQ: hech qanday chegara qo'yilmaydi (barcha shaxslar kiradi).
  // Yoqilganda pastdagi summa (Umumiy ≥ / har firmadan ≥) qo'llanadi.
  const [filterOn, setFilterOn] = useState(false);
  // O'chiq bo'lsa chegara 0 — hamma o'tadi; yoqilganda kiritilgan summa.
  const eff = useCallback((o: { thresholdTotal: number; perFirmMin: number }) => (filterOn ? o : { thresholdTotal: 0, perFirmMin: 0 }), [filterOn]);

  const runPreview = useCallback(async (o: { thresholdTotal: number; perFirmMin: number }) => {
    setApplying(true);
    const { ok, json } = await jpost(`/api/talabnoma-form/${batch.id}/preview`, o);
    if (ok) setResult(json.result);
    setApplying(false);
  }, [batch.id]);

  const applyInline = (t = totalStr, pf = perFirmStr) => {
    const o = { thresholdTotal: Number(t) || 0, perFirmMin: Number(pf) || 0 };
    setTotalStr(String(o.thresholdTotal)); setPerFirmStr(String(o.perFirmMin));
    setOpts(o); void runPreview(eff(o));
  };

  // READY bo'lganda yoki filtr yoqil/o'chirilganda — ko'rinishni qayta hisoblaymiz.
  useEffect(() => { if (batch.status === 'READY') void runPreview(eff(opts)); /* eslint-disable-next-line */ }, [batch.status, batch.id, filterOn]);

  if (batch.status === 'PARSING') {
    const pct = batch.totalRows > 0 ? Math.min(99, Math.round((batch.processedRows / batch.totalRows) * 100)) : 0;
    return (
      <div className="card p-8">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium"><Spinner size={16} /> {t('Excel‘lar tahlil qilinmoqda…')}</span>
          <button
            className="btn-ghost px-2.5 py-1.5 text-xs"
            onClick={async () => { await fetch(`/api/talabnoma-form/${batch.id}/reparse`, { method: 'POST' }); await onChanged(); }}
            title={t('Agar to‘xtab qolsa, tahlilni qayta boshlaydi')}
          >
            <Ico.refresh size={14} /> {t('Qayta urinish')}
          </button>
        </div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-xs text-muted">{t('Портфель o‘qilmoqda')}</span>
          <span className="text-lg font-semibold tabular-nums text-brand-600 dark:text-brand-400">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-brand-600 transition-all duration-500 dark:bg-brand-400" style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">
          {n(batch.processedRows)}{batch.totalRows > 0 ? ` / ~${n(batch.totalRows)}` : ''} {t('qator · sahifadan chiqsangiz ham davom etadi')}
        </p>
      </div>
    );
  }
  if (batch.status === 'FAILED') {
    return <div className="card p-6 text-sm text-rose-600 dark:text-rose-300">{t('Tahlil xatosi')}: {batch.message || t('nomaʼlum')}</div>;
  }

  const doGenerate = async (firm: FirmBucket, kind: 'REYESTR' | 'LETTERS') => {
    setNote('');
    if (!firm.ready) {
      const ok = await confirm({
        title: t('To‘liq forma tayyor emas'),
        description: `«${firm.name}» — ${t('bu firma uchun talabnoma formasi to‘liq emas.')} ${n(firm.personCount)} ${t('ta shaxs bor. Baribir tayyorlansinmi?')}`,
        confirmLabel: t('Ha, tayyorla'), danger: true,
      });
      if (!ok) return;
    }
    setBusyFirm(firm.code + kind);
    try {
      const { ok, status, json } = await jpost(`/api/talabnoma-form/${batch.id}/generate`, {
        firmCode: firm.code, firmName: firm.name, kind, ...eff(opts), includeUnready: !firm.ready,
      });
      if (!ok) { setNote(json.error || `${t('Xatolik')} (${status})`); return; }
      if (kind === 'REYESTR') {
        window.location.href = `/api/talabnoma-form/${batch.id}/download/${json.runId}`;
      } else {
        setNote(`${t('Xatlar tayyorlanmoqda')} (${n(json.rowCount ?? firm.personCount)} ${t('ta')}) — ${t('Tarixdan yuklab olasiz.')}`);
      }
      await onChanged();
    } finally { setBusyFirm(null); }
  };

  // «Barcha firmalar — bitta Excel»: nechta firmadan bo'lsa ham hammasi bitta faylda yuklab olinadi.
  const doGenerateAll = async () => {
    setNote(''); setBusyFirm('__ALL__');
    try {
      const { ok, status, json } = await jpost(`/api/talabnoma-form/${batch.id}/generate`, { all: true, format: 'excel', ...eff(opts) });
      if (!ok) { setNote(json.error || `${t('Xatolik')} (${status})`); return; }
      window.location.href = `/api/talabnoma-form/${batch.id}/download/${json.runId}`;
      await onChanged();
    } finally { setBusyFirm(null); }
  };

  // «Barcha firmalar — ZIP»: har firma alohida papkada (alohida PDF xatlar). Fon jarayoni → Tarixdan.
  const doGenerateAllZip = async () => {
    setNote(''); setBusyFirm('__ALLZIP__');
    try {
      const { ok, status, json } = await jpost(`/api/talabnoma-form/${batch.id}/generate`, { all: true, format: 'zip', ...eff(opts) });
      if (!ok) { setNote(json.error || `${t('Xatolik')} (${status})`); return; }
      setNote(t('ZIP tayyorlanmoqda (har firma alohida papka) — pastdagi «Amallar tarixi»dan yuklab olasiz.'));
      await onChanged();
    } finally { setBusyFirm(null); }
  };

  return (
    <div className="space-y-5">
      {/* summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('List 1 shaxs')} value={n(batch.candidateCount)} />
        <StatCard label={t('Chegaradan o‘tgan')} value={n(result?.qualifiedPeople ?? batch.qualifiedCount)} accent />
        <StatCard label={t('Tayyor firma bilan')} value={n(result?.readyPersonCount ?? 0)} good />
        <StatCard label={t('Tayyor emas')} value={n(result?.unreadyPersonCount ?? 0)} bad />
      </div>

      {/* inline filter bar — always visible */}
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Ico.layer size={16} className="text-brand-600 dark:text-brand-400" /> {t('Filtr')}
          {applying && <Spinner size={14} />}
          {/* Qarzdorlik filtri — yoq/o'chir. Default o'chiq → barcha shaxslar kiradi. */}
          <button
            type="button"
            role="switch"
            aria-checked={filterOn}
            onClick={() => { const nf = !filterOn; if (nf && !(Number(totalStr) > 0)) { setTotalStr('2000000'); setOpts((o) => ({ ...o, thresholdTotal: 2_000_000 })); } setFilterOn(nf); }}
            className="ml-auto inline-flex items-center gap-2 text-xs font-medium"
            title={t('Qarzdorlik summasi bo‘yicha filtrni yoqish/o‘chirish')}
          >
            <span className={cx('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', filterOn ? 'bg-brand-600 dark:bg-brand-500' : 'bg-surface-2 border border-line')}>
              <span className={cx('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', filterOn ? 'translate-x-4' : 'translate-x-0.5')} />
            </span>
            <span className={filterOn ? 'text-brand-600 dark:text-brand-400' : 'text-muted'}>
              {filterOn ? t('Qarzdorlik filtri: yoqilgan') : t('Qarzdorlik filtri: o‘chiq (hammasi)')}
            </span>
          </button>
        </div>
        <div className={cx('flex flex-wrap items-end gap-3 transition-opacity', !filterOn && 'pointer-events-none opacity-40')}>
          <label className="min-w-[180px] flex-1">
            <span className="field-label">{t('1) Umumiy qarzdorlik ≥ (so‘m)')}</span>
            <input className="field-input tabular-nums" inputMode="numeric" disabled={!filterOn} value={fmtInt(totalStr)}
              onChange={(e) => setTotalStr(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && applyInline()} />
          </label>
          <label className="min-w-[180px] flex-1">
            <span className="field-label">{t('2) Har firmadan ≥ (so‘m) · ixtiyoriy')}</span>
            <input className="field-input tabular-nums" inputMode="numeric" disabled={!filterOn} value={fmtInt(perFirmStr)}
              onChange={(e) => setPerFirmStr(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && applyInline()} />
          </label>
          <button className="btn-primary shrink-0" disabled={!filterOn} onClick={() => applyInline()}>{t('Qo‘llash')}</button>
        </div>
        {filterOn && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">{t('Tez tanlov')}:</span>
            {[2_000_000, 3_000_000, 5_000_000, 10_000_000].map((v) => (
              <button key={v} onClick={() => applyInline(String(v))}
                className={cx('badge transition-colors hover:bg-surface-2', opts.thresholdTotal === v ? 'border-brand-500/40 text-brand-600 dark:text-brand-400' : 'border-line text-muted')}>
                {n(v)} {t('so‘m')}
              </button>
            ))}
          </div>
        )}
      </div>

      {note && <div className="card border-brand-500/30 bg-brand-500/5 p-3 text-sm text-fg">{note}</div>}

      {/* per-firm table */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">{t('Firmalar bo‘yicha')}</span>
          {/* Nechta firma bo'lsa ham — hammasi bittada: Excel yoki PDF (firmalar ichida). */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">{t('Barcha firmalar — hammasi bittada')}:</span>
            <button className="btn-primary px-3 py-1.5 text-xs" disabled={busyFirm === '__ALL__'} onClick={doGenerateAll} title={t('Barcha firmalar bitta Excel faylda — Firma ustuni bilan')}>
              {busyFirm === '__ALL__' ? <Spinner size={14} /> : <Ico.sheet size={14} />} Excel
            </button>
            <button className="btn-primary px-3 py-1.5 text-xs" disabled={busyFirm === '__ALLZIP__'} onClick={doGenerateAllZip} title={t('Barcha firmalar — ZIP: har firma alohida papka (alohida PDF xatlar, muhrsiz)')}>
              {busyFirm === '__ALLZIP__' ? <Spinner size={14} /> : <Ico.files size={14} />} PDF (ZIP)
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-left">{t('Firma')}</th>
                <th className="px-4 py-2 text-right">{t('Shaxs')}</th>
                <th className="px-4 py-2 text-right">{t('Прострочка')}</th>
                <th className="px-4 py-2 text-right">{t('Amallar')}</th>
              </tr>
            </thead>
            <tbody>
              {(result?.firms ?? []).map((f) => (
                <tr key={f.code} className={cx('border-b border-line/60', !f.ready && 'bg-rose-500/5')}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cx('font-medium', !f.ready && 'text-rose-600 dark:text-rose-300')}>{f.name}</span>
                      {f.ready
                        ? <span className="badge border-emerald-500/30 text-emerald-600 dark:text-emerald-300">{t('tayyor')}</span>
                        : <span className="badge border-rose-500/30 text-rose-600 dark:text-rose-300">{t('to‘liq forma tayyor emas')}</span>}
                    </div>
                    <div className="text-xs text-muted">{t('kod')}: {f.code}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{n(f.personCount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{n(Math.round(f.overdueSum))}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <ActBtn busy={busyFirm === f.code + 'REYESTR'} onClick={() => doGenerate(f, 'REYESTR')} icon="sheet">{t('Reyestr')}</ActBtn>
                      <ActBtn busy={busyFirm === f.code + 'LETTERS'} onClick={() => doGenerate(f, 'LETTERS')} icon="files">{t('Xatlar')}</ActBtn>
                    </div>
                  </td>
                </tr>
              ))}
              {result && !result.firms.length && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">{t('Bu filtrda firma yo‘q.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* runs history for this batch */}
      <RunsTable batch={batch} />
    </div>
  );
}

function StatCard({ label, value, accent, good, bad }: { label: string; value: string; accent?: boolean; good?: boolean; bad?: boolean }) {
  return (
    <div className="card p-4">
      <div className={cx('text-2xl font-semibold tabular-nums', accent && 'text-brand-600 dark:text-brand-400', good && 'text-emerald-600 dark:text-emerald-300', bad && 'text-rose-600 dark:text-rose-300')}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}

function ActBtn({ children, onClick, busy, icon }: { children: React.ReactNode; onClick: () => void; busy: boolean; icon: keyof typeof Ico }) {
  const I = Ico[icon] as React.ComponentType<{ size?: number }> | undefined;
  return (
    <button onClick={onClick} disabled={busy} className="btn-ghost px-2.5 py-1.5 text-xs">
      {busy ? <Spinner size={14} /> : I ? <I size={14} /> : null} {children}
    </button>
  );
}

function RunsTable({ batch }: { batch: Batch }) {
  const t = useT();
  if (!batch.runs.length) return null;
  const kindLabel: Record<string, string> = { REYESTR: t('Reyestr'), LETTERS: t('Xatlar'), HIPPO: 'xat.hippo' };
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">{t('Amallar tarixi')}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {batch.runs.map((r) => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="px-4 py-2.5">
                  <span className="font-medium">{kindLabel[r.kind] ?? r.kind}</span>
                  <span className="ml-2 text-muted">{r.firmName}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">{n(r.rowCount)} {t('ta')}</td>
                <td className="px-4 py-2.5 text-center"><StatusPill status={r.status} /></td>
                <td className="px-4 py-2.5 text-right text-xs text-muted">{dt(r.createdAt)}</td>
                <td className="px-4 py-2.5 text-right">
                  {r.status === 'DONE' && r.resultPath ? (
                    <a className="btn-ghost px-2.5 py-1.5 text-xs" href={`/api/talabnoma-form/${batch.id}/download/${r.id}`}>
                      <Ico.download size={14} /> {t('Yuklab olish')}
                    </a>
                  ) : r.kind === 'HIPPO' && r.status === 'DONE' ? (
                    <span className="text-xs text-emerald-600 dark:text-emerald-300">#{r.hippoRegistryId ?? '—'}</span>
                  ) : r.status === 'FAILED' ? (
                    <span className="text-xs text-rose-600 dark:text-rose-300" title={r.message ?? ''}>{r.message?.slice(0, 30) ?? t('xato')}</span>
                  ) : r.kind === 'LETTERS' && r.status === 'RUNNING' && r.rowCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tabular-nums text-amber-600 dark:text-amber-300" title={t('Xatlar tayyorlanmoqda')}>
                      <Spinner size={12} /> {n(r.personCount)} / {n(r.rowCount)} {t('ta yasalmoqda')}
                    </span>
                  ) : <Spinner size={14} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

