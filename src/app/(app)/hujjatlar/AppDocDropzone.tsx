'use client';

// Server-hujjat (app-doc) uchun Excel dropzone — portfel importidagi Dropzone bilan AYNAN bir uslub.
// Import formasi ichida, boshqa dropzone'lar qatorida turadi. Tanlangach darrov /api/app-docs ga
// yuklanadi (mustaqil, Yuklash tugmasiga bog'liq emas). Faqat .xlsx.
import React from 'react';
import type { AppDocFile, AppDocKey } from '@/lib/app-docs';
import { DocInfo, ReqChip, type DocInfoKind } from './DocInfo';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const KB = 1024;
const fmtSize = (b: number | null) => (!b || b <= 0 ? '' : b < KB * KB ? `${Math.max(1, Math.round(b / KB))} KB` : `${(b / KB / KB).toFixed(1)} MB`);

type Accent = 'brand' | 'amber';
const ACCENT: Record<Accent, { ring: string; icon: string; badge: string }> = {
  brand: { ring: 'hover:border-brand-500/60 hover:bg-brand-500/5', icon: 'bg-brand-500/10 text-brand-600 dark:text-brand-400', badge: 'bg-brand-500/10 text-brand-600 dark:text-brand-300' },
  amber: { ring: 'hover:border-amber-500/60 hover:bg-amber-500/5', icon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
};

// QULF: faqat KO'RINADI (yuklab olish). Yuklash/almashtirish/o'chirish YO'Q (admin ham) — hujjat paketi
// bir marta yuklangach qat'iy saqlanadi; o'zgartirish faqat kod/DB orqali.
export function AppDocDropzone({ k, label, hint, accent = 'brand', initial, info, required }: {
  k: AppDocKey; label: string; hint: string; accent?: Accent; initial: AppDocFile; info?: DocInfoKind; required?: boolean;
}) {
  const a = ACCENT[accent];
  const file = initial;
  return (
    <div>
      <span className="field-label flex flex-wrap items-center gap-2">{label}{required !== undefined && <ReqChip required={required} />}{info && <DocInfo kind={info} />}<span className="text-muted" title="Qulflangan — o‘zgartirib/o‘chirib bo‘lmaydi">🔒</span></span>
      {file.present ? (
        <div className="flex items-center gap-3 rounded-xl border border-line p-3">
          <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[11px] font-bold uppercase', a.badge)}>xlsx</span>
          <a href={`/api/app-docs?download=${k}`} title="Yuklab olish" className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{file.label}</span>
            <span className="block text-xs text-muted">{fmtSize(file.size)} · yuklab olish</span>
          </a>
          <span className="shrink-0 text-muted">🔒</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3.5 text-muted">
          <span className="text-sm">Yuklanmagan</span>
          <span className="ml-auto truncate text-[11px]">{hint} · faqat kod/DB orqali</span>
        </div>
      )}
    </div>
  );
}
