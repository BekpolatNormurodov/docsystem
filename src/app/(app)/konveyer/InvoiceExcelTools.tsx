'use client';

import React, { useRef, useState } from 'react';
import { Ico } from '@/ui';

const n = (x: number) => x.toLocaleString('ru-RU');

interface ImportResult {
  applied: boolean; totalRows: number; matched: number;
  willAssign: number; assigned: number; willMarkPaid: number; markedPaid: number;
  alreadyHas: number; notFound: number; ambiguous: number; notFoundSamples: string[];
}

/**
 * Invoice Excel — eksport (sonlari bilan) + import («BFF …» kvitansiya roʻyxati).
 * Import: fayl (Қарздор ФИО + Квитанция рақами) yuklaganda avval «koʻrib chiqish» — faylda nechta,
 * nechta client topildi, nechta yangi biriktiriladi — koʻrsatiladi; foydalanuvchi TASDIQLAGACH
 * («bazaga saqlansinmi?») kvitansiyalar mijozlarga yoziladi (invoice «chiqarilgan» boʻladi).
 */
export function InvoiceExcelTools({ snapshotId, firmId, firms, count, onChanged, showExport = true }: {
  snapshotId?: number; firmId?: number; firms?: { id: number; name: string }[]; count?: number; onChanged?: () => void; showExport?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selFirm, setSelFirm] = useState<number | ''>('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingFile = useRef<File | null>(null);

  // Import qaysi firmaga tegishli: prop (scoped) yoki tanlangan firma. Firma tanlanmasa — import yo'q.
  const needFirmPick = !firmId && !!firms?.length;
  const effFirm = firmId ?? (selFirm || undefined);

  const qs = new URLSearchParams({ type: 'invoice' });
  if (snapshotId) qs.set('snapshotId', String(snapshotId));
  if (effFirm) qs.set('firmId', String(effFirm));

  const send = async (f: File, apply: boolean): Promise<ImportResult> => {
    const fd = new FormData();
    fd.append('file', f);
    if (snapshotId) fd.append('s', String(snapshotId));
    if (effFirm) fd.append('firmId', String(effFirm));
    fd.append('mode', apply ? 'apply' : 'preview');
    const res = await fetch('/konveyer/invoice-batch/import', { method: 'POST', body: fd });
    const d = await res.json();
    if (!res.ok) throw new Error(d?.error ?? 'Import xatosi');
    return d as ImportResult;
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (needFirmPick && !effFirm) { setErr('Avval firmani tanlang'); return; }
    setBusy(true); setErr(null); setPreview(null); setDone(null);
    try {
      const p = await send(f, false); // koʻrib chiqish — hech narsa yozilmaydi
      pendingFile.current = f;
      setPreview(p);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Import xatosi'); }
    finally { setBusy(false); }
  };

  const confirmApply = async () => {
    const f = pendingFile.current;
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const r = await send(f, true);
      setDone(r); setPreview(null); pendingFile.current = null;
      onChanged?.();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Import xatosi'); }
    finally { setBusy(false); }
  };

  const cancelPreview = () => { setPreview(null); pendingFile.current = null; setErr(null); };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showExport && (
          <a href={`/konveyer/generated/excel?${qs.toString()}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300"
            title="Invoyslar roʻyxatini Excel qilib yuklab olish">
            <Ico.sheet size={13} /> Excel eksport{typeof count === 'number' ? ` (${n(count)})` : ''}
          </a>
        )}
        {needFirmPick && (
          <select value={selFirm} onChange={(e) => setSelFirm(e.target.value ? Number(e.target.value) : '')}
            aria-label="Import uchun firma"
            className="rounded-lg border border-[var(--field-line)] bg-[var(--field)] px-2 py-1.5 text-[11px] font-medium text-fg outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15">
            <option value="">Firma tanlang…</option>
            {firms!.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <button onClick={() => fileRef.current?.click()} disabled={busy || (needFirmPick && !effFirm)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-500/15 disabled:opacity-60 dark:text-brand-300"
          title="«BFF …» kvitansiya roʻyxatini yuklash — avval firmani tanlang, sonlar koʻrsatiladi, tasdiqlasangiz saqlanadi">
          {busy && !preview ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Ico.download size={13} />} Excel import (kvitansiya)
        </button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
        <button onClick={() => setInfo((v) => !v)} aria-expanded={info}
          className="grid h-6 w-6 place-items-center rounded-full border border-line text-[11px] font-bold text-muted transition-colors hover:border-brand-500/40 hover:text-brand-600 dark:hover:text-brand-400"
          title="Import formati">?</button>
        {done && <span role="status" className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">✓ {n(done.assigned)} biriktirildi{done.markedPaid ? ` · ${n(done.markedPaid)} toʻlandi` : ''}{done.alreadyHas ? ` · ${n(done.alreadyHas)} avval bor` : ''}{done.notFound ? ` · ${n(done.notFound)} topilmadi` : ''}</span>}
        {err && <span role="alert" className="text-[11px] font-medium text-rose-500">{err}</span>}
      </div>

      {info && (
        <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
          <div className="mb-1 font-semibold text-fg">Import Excel formati — «BFF …» (farmoyish)</div>
          Ustunlar (sarlavha katta-kichik / kirill-lotin farqi yoʻq):
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li><b>Қарздор ФИО</b> (yoki <b>PINFL</b>) — mijozни topish uchun</li>
            <li><b>Квитанция рақами</b> — mijozga biriktiriladigan kvitansiya (majburiy)</li>
            <li><i>Почта харажати</i> (summa), <i>Holat</i> — ixtiyoriy</li>
          </ul>
          <div className="mt-1">Kvitansiya mijozga yozilib, u «invoice chiqarilgan» boʻladi. <a href="/konveyer/invoice-batch/import" className="font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">Namuna Excel yuklab olish</a></div>
        </div>
      )}

      {preview && (
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.04] px-3 py-2.5">
          <div className="text-[11px] font-semibold text-fg">Koʻrib chiqish — faylda <b className="tabular-nums">{n(preview.totalRows)}</b> ta · client topildi <b className="tabular-nums">{n(preview.matched)}</b></div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
            <span className="text-brand-600 dark:text-brand-400">Yangi biriktiriladi: <b>{n(preview.willAssign)}</b></span>
            <span className="text-muted">Allaqachon bor: <b>{n(preview.alreadyHas)}</b></span>
            <span className="text-muted">Topilmadi: <b>{n(preview.notFound)}</b></span>
            {preview.ambiguous > 0 && <span className="text-muted">Noaniq (F.I.O takror): <b>{n(preview.ambiguous)}</b></span>}
          </div>
          {preview.notFound > 0 && preview.notFoundSamples.length > 0 && (
            <div className="mt-1 truncate text-[10px] text-muted" title={preview.notFoundSamples.join(', ')}>Topilmadi: {preview.notFoundSamples.slice(0, 5).join(', ')}{preview.notFound > 5 ? '…' : ''}</div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] font-medium text-fg">Bazaga saqlansinmi?</span>
            <button onClick={confirmApply} disabled={busy || preview.willAssign === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-500 disabled:opacity-50">
              {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : '✓'} Saqlash{preview.willAssign > 0 ? ` (${n(preview.willAssign)})` : ''}
            </button>
            <button onClick={cancelPreview} disabled={busy} className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2">Bekor</button>
            {preview.willAssign === 0 && <span className="text-[10px] text-muted">Yangi biriktiradigan yoʻq</span>}
          </div>
        </div>
      )}
    </div>
  );
}
