'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchNormal1, ArrowDown2 } from 'iconsax-react';

const pretty = (d: string) => d.split('-').reverse().join('.');

export function MijozlarFilters({ dates, date, initialQ }: { dates: string[]; date: string; initialQ: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [open, setOpen] = useState(false);
  const [dq, setDq] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  function go(nextDate: string, nextQ: string) {
    const p = new URLSearchParams();
    p.set('date', nextDate);
    if (nextQ.trim()) p.set('q', nextQ.trim());
    p.set('page', '1');
    return `/mijozlar?${p.toString()}`;
  }

  // Real-time search — debounced, replace so typing doesn't flood history.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => router.replace(go(date, q)), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Close the date dropdown on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = dates.filter((d) => pretty(d).includes(dq.trim()) || d.includes(dq.trim()));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="relative" ref={box}>
        <span className="field-label">Sana</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="field-input flex min-w-[170px] items-center justify-between gap-2"
        >
          <span className="font-medium">{pretty(date)}</span>
          <ArrowDown2 size={16} className={`text-muted transition ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute z-30 mt-1 w-full min-w-[210px] rounded-xl border border-line bg-surface p-1 shadow-2xl">
            <div className="relative p-1">
              <SearchNormal1 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={dq}
                onChange={(e) => setDq(e.target.value)}
                placeholder="Sana qidirish…"
                className="field-input w-full py-1.5 pl-8 text-sm"
              />
            </div>
            <div className="max-h-64 overflow-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">Topilmadi</div>
              ) : (
                filtered.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(go(d, q));
                    }}
                    className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-surface-2 ${
                      d === date ? 'font-semibold text-brand-600' : ''
                    }`}
                  >
                    {pretty(d)}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <label className="min-w-[240px] flex-1">
        <span className="field-label">Qidiruv (PINFL, F.I.Sh, passport yoki shartnoma raqami)</span>
        <div className="relative">
          <SearchNormal1 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="masalan: 3210… yoki ABDULLAYEV"
            className="field-input w-full pl-9"
          />
        </div>
      </label>
    </div>
  );
}
