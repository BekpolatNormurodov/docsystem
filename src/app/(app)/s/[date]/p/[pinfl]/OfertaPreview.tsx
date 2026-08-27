'use client';

import { useState } from 'react';

/**
 * Mijoz sahifasida bitta shartnomaning ofertasini «view» qilib ko'rsatadi. HTML server'da
 * fillOferta bilan tayyorlanadi (chromium kerak emas) va bu yerda iframe (srcDoc) ichida —
 * oferta o'z CSS'i bilan ilova stilidan izolyatsiyada — ko'rinadi.
 */
export function OfertaPreview({ label, html }: { label: string; html: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-surface-2"
      >
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
          Oferta — {label}
        </span>
        <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>
      {open && (
        <div className="border-t border-line bg-white p-1">
          <iframe
            title={`Oferta ${label}`}
            srcDoc={html}
            className="h-[70vh] w-full rounded-md border-0 bg-white"
          />
        </div>
      )}
    </div>
  );
}
