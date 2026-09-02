'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico, Modal, Select } from '@/ui';

const n = (x: number) => x.toLocaleString('ru-RU');
type Filter = 'made' | 'notmade' | 'all';
const FILTERS: [Filter, string, string][] = [
  ['made', 'Chiqarilgan', 'Kvitansiya olingan mijozlar'],
  ['notmade', 'Chiqarilmagan', 'Hali kvitansiya olinmagan'],
  ['all', 'Hammasi', 'Ikkalasi birga'],
];

interface ImportResult {
  applied: boolean; totalRows: number; matched: number;
  willAssign: number; assigned: number; willMarkPaid: number; markedPaid: number;
  alreadyHas: number; notFound: number; ambiguous: number; notFoundSamples: string[];
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'brand' | 'amber' | 'muted' }) {
  const c = tone === 'brand' ? 'text-brand-600 dark:text-brand-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'muted' ? 'text-muted' : 'text-fg';
  return (
    <div className="rounded-lg border border-line bg-surface px-2 py-1.5">
      <div className="text-[10px] leading-tight text-muted">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${c}`}>{n(value)}</div>
    </div>
  );
}

/**
 * Invoice Excel — MODAL asosidagi eksport + import.
 * Eksport: firma + holat (Chiqarilgan/Chiqarilmagan/Hammasi) tanlab, soni koʻrsatiladi, «Holat»
 * ustuni bilan yuklab olinadi. Import: «BFF …» kvitansiya roʻyxati (Қарздор ФИО + Код + Квитанция) —
 * firma tanlanib, koʻrib chiqish (sonlar) → «Bazaga saqlansinmi?» tasdiqdan keyin biriktiriladi.
 */
export function InvoiceExcelTools({ snapshotId, firmId, firms, count, onChanged, showExport = true }: {
  snapshotId?: number; firmId?: number; firms?: { id: number; name: string }[]; count?: number; onChanged?: () => void; showExport?: boolean;
}) {
  const needFirmPick = !firmId && !!firms?.length;
  const firmNameOf = (id?: number) => (id ? (firms?.find((f) => f.id === id)?.name ?? `#${id}`) : undefined);

  // ── IMPORT ─────────────────────────────────────────────────────────────────
  const [impOpen, setImpOpen] = useState(false);
  const [impFirm, setImpFirm] = useState<number | ''>('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingFile = useRef<File | null>(null);
  const impEffFirm = firmId ?? (impFirm || undefined);
  const gateFile = needFirmPick && !impEffFirm;

  const send = async (f: File, apply: boolean): Promise<ImportResult> => {
    const fd = new FormData();
    fd.append('file', f);
    if (snapshotId) fd.append('s', String(snapshotId));
    if (impEffFirm) fd.append('firmId', String(impEffFirm));
    fd.append('mode', apply ? 'apply' : 'preview');
    const res = await fetch('/konveyer/invoice-batch/import', { method: 'POST', body: fd });
    const d = await res.json();
    if (!res.ok) throw new Error(d?.error ?? 'Import xatosi');
    return d as ImportResult;
  };
  const resetPick = () => { pendingFile.current = null; setFileName(null); setPreview(null); setDone(null); setErr(null); };
  const openImport = () => { resetPick(); setImpFirm(''); setImpOpen(true); };
  const pickFile = async (f?: File | null) => {
    if (!f) return;
    if (gateFile) { setErr('Avval firmani tanlang'); return; }
    if (!/\.xlsx$/i.test(f.name)) { setErr('Faqat .xlsx fayl'); return; }
    setBusy(true); setErr(null); setPreview(null); setDone(null); setFileName(f.name);
    try { const p = await send(f, false); pendingFile.current = f; setPreview(p); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Import xatosi'); }
    finally { setBusy(false); }
  };
  const confirmApply = async () => {
    const f = pendingFile.current;
    if (!f || busy) return;
    setBusy(true); setErr(null);
    try { const r = await send(f, true); setDone(r); setPreview(null); pendingFile.current = null; onChanged?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Import xatosi'); }
    finally { setBusy(false); }
  };
  // «Arizasi topilmaganlar»ni o'sha faylni qayta yuborib, BFF formatidagi Excel qilib yuklab olamiz.
  const downloadNotFound = async () => {
    const f = pendingFile.current;
    if (!f) return;
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (snapshotId) fd.append('s', String(snapshotId));
      if (impEffFirm) fd.append('firmId', String(impEffFirm));
      fd.append('mode', 'notfound-xlsx');
      const res = await fetch('/konveyer/invoice-batch/import', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Yuklab boʻlmadi');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'arizasi-topilmaganlar.xlsx';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); }
  };
  const impFooter = done ? (
    <button onClick={() => setImpOpen(false)} className="btn-primary px-3 py-2 text-sm">Yopish</button>
  ) : preview ? (
    <>
      <button onClick={resetPick} disabled={busy} className="btn-ghost px-3 py-2 text-sm">Boshqa fayl</button>
      <button onClick={confirmApply} disabled={busy || preview.willAssign === 0 || preview.notFound > 0} className="btn-primary gap-1.5 px-3 py-2 text-sm">
        {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />} {preview.notFound > 0 ? 'Saqlab boʻlmaydi' : `Bazaga saqlash${preview.willAssign ? ` (${n(preview.willAssign)})` : ''}`}
      </button>
    </>
  ) : (
    <button onClick={() => setImpOpen(false)} className="btn-ghost px-3 py-2 text-sm">Yopish</button>
  );

  // ── EXPORT ─────────────────────────────────────────────────────────────────
  const [expOpen, setExpOpen] = useState(false);
  const [expFirm, setExpFirm] = useState<number | ''>('');
  const [expFilter, setExpFilter] = useState<Filter>('made');
  const [expCount, setExpCount] = useState<number | null>(null);
  const [expLoading, setExpLoading] = useState(false);
  const expEffFirm = firmId ?? (expFirm || undefined);

  const exportUrl = (() => {
    const p = new URLSearchParams({ type: 'invoice', made: expFilter });
    if (snapshotId) p.set('snapshotId', String(snapshotId));
    if (expEffFirm) p.set('firmId', String(expEffFirm));
    return `/konveyer/generated/excel?${p.toString()}`;
  })();

  const loadExpCount = useCallback(async () => {
    if (snapshotId == null) { setExpCount(null); return; }
    setExpLoading(true);
    const p = new URLSearchParams({ type: 'invoice', made: expFilter, page: '1', snapshotId: String(snapshotId) });
    if (expEffFirm) p.set('firmId', String(expEffFirm));
    try { const res = await fetch(`/konveyer/generated?${p.toString()}`); const d = res.ok ? await res.json() : null; setExpCount(typeof d?.total === 'number' ? d.total : null); }
    catch { setExpCount(null); }
    finally { setExpLoading(false); }
  }, [snapshotId, expEffFirm, expFilter]);
  useEffect(() => { if (expOpen) loadExpCount(); }, [expOpen, loadExpCount]);
  const openExport = () => { setExpFirm(''); setExpFilter('made'); setExpCount(null); setExpOpen(true); };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showExport && (
        <button onClick={openExport}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300">
          <Ico.sheet size={13} /> Excel eksport{typeof count === 'number' ? ` (${n(count)})` : ''}
        </button>
      )}
      <button onClick={openImport}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-500/15 dark:text-brand-300">
        <Ico.download size={13} /> Excel import (kvitansiya)
      </button>
      {done && !impOpen && <span role="status" className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">✓ {n(done.assigned)} ta invoice chiqarildi</span>}

      {/* ── EXPORT MODAL ── */}
      <Modal open={expOpen} onClose={() => setExpOpen(false)} size="md"
        title="Excel eksport — invoyslar"
        description="Firma va holatni tanlang — roʻyxat «Holat» ustuni bilan yuklanadi"
        footer={
          <>
            <button onClick={() => setExpOpen(false)} className="btn-ghost px-3 py-2 text-sm">Bekor</button>
            <a href={exportUrl} onClick={() => setExpOpen(false)}
              className={`btn-primary gap-1.5 px-3 py-2 text-sm ${!expCount ? 'pointer-events-none opacity-50' : ''}`}>
              <Ico.download size={15} /> Excel yuklab olish{expCount ? ` (${n(expCount)})` : ''}
            </a>
          </>
        }>
        <div className="space-y-4">
          {needFirmPick && (
            <div>
              <div className="field-label">Firma</div>
              <Select value={expFirm ? String(expFirm) : ''} label="Eksport firmasi" placeholder="Barcha firmalar"
                options={[{ value: '', label: 'Barcha firmalar' }, ...firms!.map((f) => ({ value: String(f.id), label: f.name }))]}
                onChange={(v) => setExpFirm(v ? Number(v) : '')} />
            </div>
          )}
          {!needFirmPick && firmNameOf(firmId) && (
            <div><div className="field-label">Firma</div><div className="rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-sm font-medium">{firmNameOf(firmId)}</div></div>
          )}
          <div>
            <div className="field-label">Holat</div>
            <div className="grid grid-cols-3 gap-2">
              {FILTERS.map(([v, l, hint]) => (
                <button key={v} type="button" onClick={() => setExpFilter(v)} aria-pressed={expFilter === v}
                  className={`rounded-xl border px-2 py-2 text-left transition-colors ${expFilter === v ? 'border-brand-500 bg-brand-500/10' : 'border-line hover:border-brand-500/40'}`}>
                  <div className={`text-xs font-semibold ${expFilter === v ? 'text-brand-700 dark:text-brand-300' : 'text-fg'}`}>{l}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-muted">{hint}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-3 py-2.5 text-sm">
            <span className="text-muted">Yuklanadi:</span>
            <span className="font-bold tabular-nums text-brand-700 dark:text-brand-300">{expLoading ? '…' : expCount != null ? `${n(expCount)} ta` : '—'}</span>
          </div>
          <div className="text-[11px] leading-relaxed text-muted">Ustunlar: F.I.O · PINFL · Firma · Sud · Kvitansiya raqami · <b className="text-fg">Holat</b> · Sana.</div>
        </div>
      </Modal>

      {/* ── IMPORT MODAL ── */}
      <Modal open={impOpen} onClose={() => setImpOpen(false)} size="lg"
        title="Kvitansiya import — Excel"
        description="«BFF …» roʻyxati (Қарздор ФИО + Код + Квитанция рақами) — kvitansiya mijozlarga biriktiriladi"
        footer={impFooter}>
        <div className="space-y-4">
          <div>
            <div className="field-label">Firma {needFirmPick && <span className="text-rose-500">*</span>}</div>
            {needFirmPick ? (
              <Select value={impFirm ? String(impFirm) : ''} label="Import uchun firma" placeholder="Firma tanlang…"
                options={firms!.map((f) => ({ value: String(f.id), label: f.name }))}
                onChange={(v) => { setImpFirm(v ? Number(v) : ''); resetPick(); }} />
            ) : (
              <div className="rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-sm font-medium">{firmNameOf(firmId) ?? 'Barcha firmalar'}</div>
            )}
          </div>

          <div className="rounded-xl border border-line bg-surface-2/40 px-3 py-2.5 text-xs leading-relaxed text-muted">
            <div className="mb-1 font-semibold text-fg">Excel ustunlari</div>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><b>Қарздор ФИО</b> — mijozni topish uchun</li>
              <li><b>Код</b> — mijoz kodi (ixtiyoriy, aniqlik uchun)</li>
              <li><b>Квитанция рақами</b> — biriktiriladigan kvitansiya <span className="text-rose-500">(majburiy)</span></li>
              <li><i>Почта харажати</i>, <i>Holat</i> — ixtiyoriy</li>
            </ul>
            <a href="/konveyer/invoice-batch/import" className="mt-1.5 inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400">
              <Ico.download size={12} /> Namuna Excel yuklab olish
            </a>
          </div>

          {!done && (
            <label
              onDragOver={(e) => { if (gateFile) return; e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { if (gateFile) return; e.preventDefault(); setDrag(false); void pickFile(e.dataTransfer.files?.[0]); }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${drag ? 'border-brand-500 bg-brand-500/5' : 'border-line hover:border-brand-500/40'} ${gateFile ? 'pointer-events-none opacity-50' : ''}`}>
              <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pickFile(f); }} />
              <Ico.sheet size={22} className="text-brand-500/70" />
              <div className="text-sm font-medium text-fg">{fileName ?? 'Excel (.xlsx) faylni tanlang yoki shu yerga tashlang'}</div>
              {gateFile ? <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Avval firmani tanlang</div>
                : busy && !preview ? <div className="text-[11px] text-muted">Oʻqilmoqda…</div>
                : <div className="text-[11px] text-muted">Tanlanganda avval sonlar koʻrsatiladi</div>}
            </label>
          )}

          {err && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">{err}</div>}

          {preview && !done && (
            <div className={`rounded-xl border p-3 ${preview.notFound > 0 ? 'border-rose-500/30 bg-rose-500/[0.04]' : 'border-brand-500/30 bg-brand-500/[0.04]'}`}>
              <div className="text-xs font-semibold text-fg">Koʻrib chiqish — faylda <span className="tabular-nums">{n(preview.totalRows)}</span> ta</div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Biriktiriladi" value={preview.willAssign} tone="brand" />
                <Stat label="Allaqachon bor" value={preview.alreadyHas} tone="muted" />
                <Stat label="Arizasi topilmadi" value={preview.notFound} tone={preview.notFound ? 'amber' : 'muted'} />
                <Stat label="Noaniq (F.I.O)" value={preview.ambiguous} tone="muted" />
              </div>
              {preview.notFound > 0 ? (
                <div className="mt-2.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-2.5 py-2 text-[11px] font-medium text-rose-600 dark:text-rose-300">
                  <b>{n(preview.notFound)} ta mijozning arizasi topilmadi</b> — saqlab boʻlmaydi. Avval ular uchun ariza yarating, keyin qayta import qiling.
                  {preview.notFoundSamples.length > 0 && <div className="mt-1 truncate font-normal text-muted" title={preview.notFoundSamples.join(', ')}>{preview.notFoundSamples.slice(0, 8).join(', ')}{preview.notFound > preview.notFoundSamples.length ? '…' : ''}</div>}
                  <button type="button" onClick={downloadNotFound} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300">
                    <Ico.sheet size={13} /> Topilmaganlarni Excel qilib olish ({n(preview.notFound)})
                  </button>
                </div>
              ) : (
                <div className="mt-2.5 text-xs font-semibold text-fg">Bazaga saqlansinmi?</div>
              )}
            </div>
          )}

          {done && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">✓ Saqlandi</div>
              <div className="mt-1 text-xs text-muted">
                <b className="tabular-nums text-fg">{n(done.assigned)}</b> biriktirildi{done.markedPaid ? ` · ${n(done.markedPaid)} toʻlandi` : ''}{done.alreadyHas ? ` · ${n(done.alreadyHas)} avval bor` : ''}.
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
