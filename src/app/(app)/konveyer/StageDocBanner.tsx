'use client';

// Step sahifasi tepasidagi ogohlantirish: shu bosqichning IXTIYORIY hujjati yuklanmagan bo'lsa
// ko'rinadi — va AYNAN shu yerda yuklash mumkin (Hujjatlarga borish shart emas). Yuklangach yo'qoladi.
// Client komponent: holatni /api/app-docs dan o'zi oladi (server-only app-docs.ts ni import qilmaydi).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Ico, Spinner } from '@/ui';

type AppDocKey = 'talabnoma' | 'sud';
const LABEL: Record<AppDocKey, string> = {
  talabnoma: 'Talabnoma ro‘yxati',
  sud: 'Sud hujjati',
};

export function StageDocBanner({ kind }: { kind: AppDocKey }) {
  const [present, setPresent] = useState<boolean | null>(null); // null = hali tekshirilmoqda
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/app-docs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setPresent(!!j[kind]?.present); })
      .catch(() => { if (!cancelled) setPresent(true); }); // xato bo'lsa bezovta qilmaymiz
    return () => { cancelled = true; };
  }, [kind]);

  const upload = useCallback(async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', f);
      const r = await fetch('/api/app-docs', { method: 'POST', body: fd });
      if (r.ok) setPresent(true); // yuklandi → banner yo'qoladi
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  }, [kind]);

  // Hali tekshirilmoqda yoki yuklangan → hech nima ko'rsatmaymiz (flash bo'lmasin).
  if (present === null || present) return null;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); }}
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2.5 text-sm transition-colors',
        drag ? 'border-brand-500 bg-brand-500/[0.06]' : 'border-amber-500/30 bg-amber-500/[0.07]',
      )}
    >
      <svg className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
      </svg>
      <span className="text-amber-700 dark:text-amber-300">
        <b className="font-semibold">{LABEL[kind]}</b> hali yuklanmagan (ixtiyoriy)
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-500/20 disabled:opacity-60 dark:text-amber-200"
        >
          {busy ? <Spinner size={14} /> : <Ico.filePlus size={15} />}
          {busy ? 'Yuklanmoqda…' : 'Shu yerdan yuklash'}
        </button>
        <Link href="/hujjatlar" className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline">
          Hujjatlar
        </Link>
      </div>

      <input ref={ref} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
    </div>
  );
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
