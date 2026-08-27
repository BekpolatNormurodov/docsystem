'use client';

// Server-hujjat (app-doc) uchun Excel dropzone — portfel importidagi Dropzone bilan AYNAN bir uslub.
// Import formasi ichida, boshqa dropzone'lar qatorida turadi. Tanlangach darrov /api/app-docs ga
// yuklanadi (mustaqil, Yuklash tugmasiga bog'liq emas). Faqat .xlsx.
import React, { useCallback, useRef, useState } from 'react';
import { Ico, Spinner, useConfirm } from '@/ui';
import type { AppDocFile, AppDocKey } from '@/lib/app-docs';
import { DocInfo, type DocInfoKind } from './DocInfo';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const KB = 1024;
const fmtSize = (b: number | null) => (!b || b <= 0 ? '' : b < KB * KB ? `${Math.max(1, Math.round(b / KB))} KB` : `${(b / KB / KB).toFixed(1)} MB`);

type Accent = 'brand' | 'amber';
const ACCENT: Record<Accent, { ring: string; icon: string; badge: string }> = {
  brand: { ring: 'hover:border-brand-500/60 hover:bg-brand-500/5', icon: 'bg-brand-500/10 text-brand-600 dark:text-brand-400', badge: 'bg-brand-500/10 text-brand-600 dark:text-brand-300' },
  amber: { ring: 'hover:border-amber-500/60 hover:bg-amber-500/5', icon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
};
const XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function AppDocDropzone({ k, label, hint, accent = 'brand', initial, info }: {
  k: AppDocKey; label: string; hint: string; accent?: Accent; initial: AppDocFile; info?: DocInfoKind;
}) {
  const [file, setFile] = useState<AppDocFile>(initial);
  const confirm = useConfirm();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'up' | 'del' | null>(null);
  const [drag, setDrag] = useState(false);
  const a = ACCENT[accent];

  const upload = useCallback(async (f: File) => {
    setBusy('up');
    try {
      const fd = new FormData();
      fd.append('kind', k);
      fd.append('file', f);
      const r = await fetch('/api/app-docs', { method: 'POST', body: fd });
      if (r.ok) { const s = await r.json(); setFile(s[k]); }
    } finally {
      setBusy(null);
      if (ref.current) ref.current.value = '';
    }
  }, [k]);

  const remove = async () => {
    const ok = await confirm({ title: `${label}ni o‘chirish`, description: 'Yuklangan fayl o‘chiriladi. Davom etilsinmi?', confirmLabel: 'O‘chirish', danger: true });
    if (!ok) return;
    setBusy('del');
    try {
      const r = await fetch(`/api/app-docs?kind=${k}`, { method: 'DELETE' });
      if (r.ok) { const s = await r.json(); setFile(s[k]); }
    } finally { setBusy(null); }
  };

  return (
    <div>
      <span className="field-label flex items-center gap-2">{label}{info && <DocInfo kind={info} />}</span>
      <input ref={ref} type="file" accept={XLSX_ACCEPT} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />

      {file.present ? (
        <div className="flex items-center gap-3 rounded-xl border border-line p-3">
          <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[11px] font-bold uppercase', a.badge)}>xlsx</span>
          <a href={`/api/app-docs?download=${k}`} title="Yuklab olish" className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{file.label}</span>
            <span className="block text-xs text-muted">{fmtSize(file.size)} · yuklab olish</span>
          </a>
          <button type="button" onClick={() => ref.current?.click()} disabled={!!busy} aria-label="Almashtirish" title="Almashtirish"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
            {busy === 'up' ? <Spinner size={14} /> : <Ico.refresh size={15} />}
          </button>
          <button type="button" onClick={() => void remove()} disabled={!!busy} aria-label="Olib tashlash" title="O‘chirish"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-rose-500/10 hover:text-rose-500">
            {busy === 'del' ? <Spinner size={14} /> : '✕'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => ref.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); }}
          className={cx('flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 text-left transition disabled:opacity-50', drag ? 'border-brand-500 bg-brand-500/10' : cx('border-line', a.ring))}
        >
          <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full', a.icon)}>
            {busy === 'up' ? <Spinner size={16} /> : <Ico.add size={18} />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{busy === 'up' ? 'Yuklanmoqda…' : 'Fayl tanlash yoki bu yerga tashlang'}</span>
            <span className="block truncate text-xs text-muted">{hint}</span>
          </span>
        </button>
      )}
    </div>
  );
}
