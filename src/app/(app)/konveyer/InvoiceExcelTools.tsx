'use client';

import React, { useRef, useState } from 'react';
import { Ico } from '@/ui';

const n = (x: number) => x.toLocaleString('ru-RU');

interface Reconcile {
  applied: boolean; totalRows: number; matched: number;
  willMarkPaid: number; willMarkUnpaid: number; markedPaid: number; markedUnpaid: number;
  alreadyPaid: number; alreadyUnpaid: number; notFound: number; ambiguous: number; noStatus: number;
  notFoundSamples: string[];
}

/**
 * Invoice Excel — eksport (sonlari bilan) + import (to'lov holati / reconcile).
 * Import: avval fayl o'qib «ko'rib chiqish» (preview) sonlarini ko'rsatadi — nechta yangi to'lanadi,
 * nechtasi allaqachon bor, nechta topilmadi — foydalanuvchi TASDIQLAGACH saqlaydi. «?» — format + namuna.
 */
export function InvoiceExcelTools({ snapshotId, firmId, count, onChanged, showExport = true }: {
  snapshotId?: number; firmId?: number; count?: number; onChanged?: () => void; showExport?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(false);
  const [preview, setPreview] = useState<Reconcile | null>(null);
  const [done, setDone] = useState<Reconcile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingFile = useRef<File | null>(null);

  const qs = new URLSearchParams({ type: 'invoice' });
  if (snapshotId) qs.set('snapshotId', String(snapshotId));
  if (firmId) qs.set('firmId', String(firmId));

  const send = async (f: File, apply: boolean): Promise<Reconcile> => {
    const fd = new FormData();
    fd.append('file', f);
    if (snapshotId) fd.append('s', String(snapshotId));
    fd.append('mode', apply ? 'apply' : 'preview');
    const res = await fetch('/konveyer/invoice-batch/import', { method: 'POST', body: fd });
    const d = await res.json();
    if (!res.ok) throw new Error(d?.error ?? 'Import xatosi');
    return d as Reconcile;
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setErr(null); setPreview(null); setDone(null);
    try {
      const p = await send(f, false); // preview — hech narsa yozilmaydi
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
  const willChange = preview ? preview.willMarkPaid + preview.willMarkUnpaid : 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showExport && (
          <a href={`/konveyer/generated/excel?${qs.toString()}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300"
            title="Yaratilgan invoyslar roʻyxatini Excel qilib yuklab olish">
            <Ico.sheet size={13} /> Excel eksport{typeof count === 'number' ? ` (${n(count)})` : ''}
          </a>
        )}
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-500/15 disabled:opacity-60 dark:text-brand-300"
          title="Excel’dan toʻlov holatini yuklash — avval sonlar koʻrsatiladi, tasdiqlasangiz saqlanadi">
          {busy && !preview ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Ico.download size={13} />} Excel import (toʻlov)
        </button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
        <button onClick={() => setInfo((v) => !v)} aria-expanded={info}
          className="grid h-6 w-6 place-items-center rounded-full border border-line text-[11px] font-bold text-muted transition-colors hover:border-brand-500/40 hover:text-brand-600 dark:hover:text-brand-400"
          title="Import formati">?</button>
        {done && <span role="status" className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">✓ {n(done.markedPaid)} toʻlandi{done.markedUnpaid ? ` · ${n(done.markedUnpaid)} qaytarildi` : ''}{done.alreadyPaid ? ` · ${n(done.alreadyPaid)} avval bor edi` : ''}</span>}
        {err && <span role="alert" className="text-[11px] font-medium text-rose-500">{err}</span>}
      </div>

      {info && (
        <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
          <div className="mb-1 font-semibold text-fg">Import Excel formati</div>
          Ustunlar (sarlavha katta-kichik / kirill-lotin farqi yoʻq):
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li><b>Kvitansiya raqami</b> (yoki <b>Invoice raqami</b>, yoki <b>PINFL</b>) — kalit</li>
            <li><b>Holat</b> — «Toʻlandi» yoki «Toʻlanmagan»</li>
          </ul>
          <div className="mt-1">Mos invoice topilsa shu holatga oʻtkaziladi. <a href="/konveyer/invoice-batch/import" className="font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">Namuna Excel yuklab olish</a></div>
        </div>
      )}

      {preview && (
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.04] px-3 py-2.5">
          <div className="text-[11px] font-semibold text-fg">Import — koʻrib chiqish ({n(preview.totalRows)} qator)</div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">Yangi toʻlanadi: <b>{n(preview.willMarkPaid)}</b></span>
            {preview.willMarkUnpaid > 0 && <span className="text-amber-600 dark:text-amber-400">Qaytariladi: <b>{n(preview.willMarkUnpaid)}</b></span>}
            <span className="text-muted">Allaqachon bor: <b>{n(preview.alreadyPaid)}</b></span>
            <span className="text-muted">Topilmadi: <b>{n(preview.notFound)}</b></span>
            {preview.ambiguous > 0 && <span className="text-muted">Noaniq: <b>{n(preview.ambiguous)}</b></span>}
          </div>
          {preview.notFound > 0 && preview.notFoundSamples.length > 0 && (
            <div className="mt-1 truncate text-[10px] text-muted" title={preview.notFoundSamples.join(', ')}>Topilmagan: {preview.notFoundSamples.slice(0, 5).join(', ')}{preview.notFound > 5 ? '…' : ''}</div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={confirmApply} disabled={busy || willChange === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-500 disabled:opacity-50">
              {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : '✓'} Tasdiqlash{willChange > 0 ? ` (${n(willChange)})` : ''}
            </button>
            <button onClick={cancelPreview} disabled={busy} className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2">Bekor</button>
            {willChange === 0 && <span className="text-[10px] text-muted">Oʻzgartiradigan narsa yoʻq</span>}
          </div>
        </div>
      )}
    </div>
  );
}
