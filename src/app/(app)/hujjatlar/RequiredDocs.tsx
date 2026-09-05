'use client';

// «Qo'shimcha hujjatlar» — Talabnoma ro'yxati / Sud hujjati (IXTIYORIY). Portfel importidagi
// AYNAN o'sha dropzone uslubi bilan: bo'sh — dashed dropzone (bosib/tashlab yuklash), yuklangan —
// ext-badge + fayl nomi + hajmi (bosib yuklab olish) + almashtirish/o'chirish. Ochilib-yopiladigan emas.
import React from 'react';
import type { AppDocFile, AppDocKey } from '@/lib/app-docs';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const KB = 1024;
const fmtSize = (b: number | null) => (!b || b <= 0 ? '' : b < KB * KB ? `${Math.max(1, Math.round(b / KB))} KB` : `${(b / KB / KB).toFixed(1)} MB`);
const extOf = (name: string | null) => name?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? 'fayl';

// Portfel importidagi ACCENT bilan bir xil (border/hover/icon/badge ranglari mos tushsin).
type Accent = 'brand' | 'amber';
const ACCENT: Record<Accent, { ring: string; icon: string; badge: string }> = {
  brand: { ring: 'hover:border-brand-500/60 hover:bg-brand-500/5', icon: 'bg-brand-500/10 text-brand-600 dark:text-brand-400', badge: 'bg-brand-500/10 text-brand-600 dark:text-brand-300' },
  amber: { ring: 'hover:border-amber-500/60 hover:bg-amber-500/5', icon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
};

type Files = { talabnoma: AppDocFile; sud: AppDocFile };

export function ExtraDocs({ initial }: { initial: Files }) {
  // QULF: hujjat paketi faqat KO'RINADI (yuklab olish) — o'zgartirish/o'chirish YO'Q (admin ham).
  // O'zgartirish faqat kod/DB orqali. Filtrlar shu saqlangan fayllardan ishlaydi.
  return (
    <div className="card mb-8 max-w-md space-y-4 p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Hujjat paketi</h2>
        <span className="inline-flex items-center gap-1 text-xs text-muted" title="Qulflangan — UI orqali o‘zgartirib/o‘chirib bo‘lmaydi">🔒 qulflangan</span>
      </div>
      <DocZone k="talabnoma" label="Talabnoma ro‘yxati" accent="brand" file={initial.talabnoma} />
      <DocZone k="sud" label="Sud hujjati" accent="amber" file={initial.sud} />
    </div>
  );
}

// QULF: faqat ko'rinadi (yuklab olish). Yuklash/almashtirish/o'chirish YO'Q — o'zgartirish kod/DB orqali.
function DocZone({ k, label, accent, file }: { k: AppDocKey; label: string; accent: Accent; file: AppDocFile }) {
  const a = ACCENT[accent];
  return (
    <div>
      <span className="field-label">{label}</span>
      {file.present ? (
        <div className="flex items-center gap-3 rounded-xl border border-line p-3">
          <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[10px] font-bold uppercase', a.badge)}>
            {extOf(file.label)}
          </span>
          <a href={`/api/app-docs?download=${k}`} title="Yuklab olish" className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{file.label}</span>
            <span className="block text-xs text-muted">{fmtSize(file.size)} · yuklab olish</span>
          </a>
          <span className="shrink-0 text-muted" title="Qulflangan — o‘zgartirib/o‘chirib bo‘lmaydi">🔒</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3.5 text-muted">
          <span className="text-sm">Yuklanmagan</span>
          <span className="ml-auto text-[11px]">faqat kod/DB orqali qo‘yiladi</span>
        </div>
      )}
    </div>
  );
}
