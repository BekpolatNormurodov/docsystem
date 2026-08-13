'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ico } from '@/ui';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export const LANGS = [
  { code: 'uz', label: "O'zbekcha" },
  { code: 'uz-cyrl', label: 'Ўзбекча' },
  { code: 'ru', label: 'Русский' },
] as const;

/**
 * Header language switcher. Stores the choice in a `lang` cookie and refreshes; the root layout
 * reads it to set <html lang>. (Actual string translation is wired incrementally — this is the
 * system-language control + storage.)
 */
export function LanguageSwitcher({ lang }: { lang: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const cur = LANGS.find((l) => l.code === lang) ?? LANGS[0];
  const pick = (code: string) => {
    setOpen(false);
    document.cookie = `lang=${code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Til / Язык"
        title={`Til: ${cur.label}`}
        className="grid h-9 w-9 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <Ico.globe size={18} />
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 top-full z-40 mt-2 w-40 rounded-xl border border-line bg-surface p-1 shadow-xl">
          {LANGS.map((l) => {
            const active = l.code === cur.code;
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => pick(l.code)}
                className={cx(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  active ? 'bg-brand-500/10 font-semibold text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                <span>{l.label}</span>
                {active && (
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m20 6-11 11-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
