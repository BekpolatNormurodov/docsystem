'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/client';

/**
 * Oferta yuklab olish tugmasi — `/konveyer/oferta-loans?loanIds=…` (worker chromium render qiladi, bir necha
 * soniya). Bitta kredit → PDF, bir nechta → ZIP. Kutish vaqtida spinner, xato bo'lsa — matni ko'rinadi.
 * Fayl nomi server'dan (Content-Disposition filename*) — «Oferta <shartnoma> — <F.I.Sh>.pdf».
 */
export function OfertaDownload({ loanIds, label, primary = false, title }: { loanIds: number[]; label: string; primary?: boolean; title?: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (busy || !loanIds.length) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/konveyer/oferta-loans?loanIds=${loanIds.join(',')}`);
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || t('Yuklab boʻlmadi'));
      }
      const cd = res.headers.get('Content-Disposition') ?? '';
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
      const plain = /filename="([^"]+)"/i.exec(cd)?.[1];
      const name = star ? decodeURIComponent(star) : plain || (loanIds.length > 1 ? 'oferta.zip' : 'oferta.pdf');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('Yuklab boʻlmadi'));
    } finally { setBusy(false); }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        title={title}
        className={primary
          ? 'inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-wait disabled:opacity-70'
          : 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-muted outline-none transition-colors hover:border-brand-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-wait disabled:opacity-70'}
      >
        {busy
          ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>}
        {busy ? t('Tayyorlanmoqda…') : label}
      </button>
      {err && <span role="alert" className="text-[11px] font-medium text-rose-500">{err}</span>}
    </span>
  );
}
