'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SearchNormal1 } from 'iconsax-react';

interface FirmChip {
  code: string;
  name: string;
  count: number;
}

/** Real-time person-view filters: contract number (ld_id) + which firms to show. Updates the URL. */
export function PersonFilters({ initialC, firms, initialFirms }: { initialC: string; firms: FirmChip[]; initialFirms: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [c, setC] = useState(initialC);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialFirms.length ? initialFirms : firms.map((f) => f.code)),
  );
  const first = useRef(true);

  const allSelected = selected.size === firms.length;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (c.trim()) p.set('c', c.trim());
      if (!allSelected) [...selected].forEach((code) => p.append('firm', code));
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, selected]);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      // Never allow an empty selection — re-selecting all reads as "all".
      return next.size === 0 ? new Set(firms.map((f) => f.code)) : next;
    });
  }

  return (
    <div className="mb-4 space-y-3">
      <label className="block max-w-sm">
        <span className="field-label">Shartnoma raqami boʻyicha qidirish</span>
        <div className="relative">
          <SearchNormal1 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={c}
            onChange={(e) => setC(e.target.value)}
            placeholder="masalan: 12345"
            className="field-input w-full pl-9"
          />
        </div>
      </label>

      {firms.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {firms.map((f) => {
            const on = selected.has(f.code);
            return (
              <button
                key={f.code}
                type="button"
                onClick={() => toggle(f.code)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                  on ? 'border-brand-500/60 bg-brand-500/10 text-fg' : 'border-line text-muted hover:bg-surface-2'
                }`}
              >
                {f.name}
                <span className="opacity-60">{f.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
