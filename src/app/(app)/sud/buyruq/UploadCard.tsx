'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Ico, Spinner } from '@/ui';
import { useT } from '@/lib/i18n/client';

interface Firm { code: string; shortName: string }

interface Result { total: number; filled: number; unmatched: number; name: string; url: string }

// Buyruq shabloni upload kartochkasi — drag-drop, firma tanlash, progress, natija toast'i.
// Server javob header'idan matched/unmatched sonini o'qib jonli ko'rsatadi. Blob'ni yuklab olishga
// download tugmasi bo'ladi — brauzer sarlavhali Content-Disposition bilan ochib beradi.
export default function UploadCard({ firms }: { firms: Firm[] }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [firm, setFirm] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null | undefined) => {
    setErr(null); setResult(null);
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { setErr(t('Faqat .xlsx qabul qilinadi')); return; }
    if (f.size > 20 * 1024 * 1024) { setErr(t('Fayl juda katta (max 20MB)')); return; }
    setFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    pick(e.dataTransfer.files?.[0] ?? null);
  }, []);

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (firm) fd.append('firm', firm);
      const r = await fetch('/sud/buyruq/fill', { method: 'POST', body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      const total = Number(r.headers.get('X-Buyruq-Total')) || 0;
      const filled = Number(r.headers.get('X-Buyruq-Filled')) || 0;
      const unmatched = Number(r.headers.get('X-Buyruq-Unmatched')) || 0;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const cd = r.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/);
      const name = decodeURIComponent(m?.[1] || m?.[2] || file.name.replace(/\.xlsx$/i, '') + ' — toʻldirilgan.xlsx');
      setResult({ total, filled, unmatched, name, url });
      // Auto-download: sinovsiz osilib turmasin, foydalanuvchi bosmasa ham darrov saqlansin.
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setErr(null); if (inputRef.current) inputRef.current.value = ''; };

  const pct = result && result.total > 0 ? Math.round((result.filled / result.total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="rounded-lg bg-emerald-100 p-1.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          <Ico.filePlus size={16} />
        </div>
        <div>
          <div className="text-sm font-semibold text-fg">{t('Namunani toʻldirish')}</div>
          <div className="text-xs text-muted">{t('Shablonni yuklang — asosiy qarz, boji (4%), manzil, pasport, JSHSHIR toʻldirilgan Excel qaytariladi')}</div>
        </div>
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          drag ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/10' : 'border-line bg-surface-2/40 hover:border-emerald-400 hover:bg-emerald-50/30 dark:hover:bg-emerald-500/5'
        }`}
      >
        <input ref={inputRef} type="file" accept=".xlsx" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <Ico.sheet size={28} className="mb-2 text-muted" />
        {file ? (
          <>
            <div className="text-sm font-medium text-fg">{file.name}</div>
            <div className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB · {t('boshqa fayl uchun yana bosing yoki tashlang')}</div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium text-fg">{t('Faylni tashlang yoki tanlang')}</div>
            <div className="text-xs text-muted">.xlsx · {t('max 20MB')}</div>
          </>
        )}
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t('Firma')}:</span>
          <select value={firm} onChange={(e) => setFirm(e.target.value)} className="field-input">
            <option value="">{t('Hammasi (avtomatik)')}</option>
            {firms.map((f) => <option key={f.code} value={f.code}>{f.shortName}</option>)}
          </select>
        </label>
        <button type="button" onClick={submit} disabled={!file || busy} className="btn-primary ml-auto">
          {busy ? <><Spinner size={16} /> {t('Toʻldirilmoqda…')}</> : <><Ico.download size={16} /> {t('Toʻldirib olish')}</>}
        </button>
        {(file || result) && !busy && (
          <button type="button" onClick={reset} className="btn-ghost">{t('Tozalash')}</button>
        )}
      </div>

      {err && <div className="mt-3 rounded-lg border border-rose-300/40 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{err}</div>}

      {result && (
        <div className="mt-3 rounded-xl border border-emerald-300/40 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <Ico.check size={16} /> {t('Tayyor')}: {result.filled} / {result.total} {t('mijoz toʻldirildi')} ({pct}%)
            {result.unmatched > 0 && <span className="ml-auto text-xs font-normal text-amber-700 dark:text-amber-300">{t('Topilmadi')}: {result.unmatched}</span>}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-500/15">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <a href={result.url} download={result.name} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-300">
            <Ico.download size={14} /> {result.name}
          </a>
        </div>
      )}
    </div>
  );
}
