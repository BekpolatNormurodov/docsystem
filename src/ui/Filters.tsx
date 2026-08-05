'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { STATUS_LABELS, DOC_TYPE_SHORT } from '../core/labels';
import type { CertStatus } from '../core/enums';
import { Ico } from './icons';
import { Select, type Option } from './Select';
import { DatePicker } from './DatePicker';
import { STATUS_DOT } from './tokens';

export type FirmOpt = { id: string; name: string; shortName: string | null };

/**
 * URL-driven filter panel shared by every list. Omit `statuses` on lists whose
 * status is fixed (e.g. the rahbar queues) and the status dropdown disappears.
 */
export function Filters({
  firms,
  statuses,
  docTypes,
  searchPlaceholder = '№, F.I.SH., PINFL, passport, shartnoma…',
}: {
  firms?: FirmOpt[];
  statuses?: readonly CertStatus[];
  /** Pass the doc types a list holds to show a type dropdown; omit on single-type lists. */
  docTypes?: readonly (keyof typeof DOC_TYPE_SHORT)[];
  searchPlaceholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [q, setQ] = useState(sp.get('q') ?? '');
  const mounted = useRef(false);

  function apply(next: Record<string, string>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete('page'); // any filter change resets to page 1
    router.push(`${pathname}?${p.toString()}`);
  }

  // Debounced search; skip the first run so mounting never navigates.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => {
      if ((sp.get('q') ?? '') !== q) apply({ q });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const status = sp.get('status') ?? '';
  const firm = sp.get('firm') ?? '';
  const docType = sp.get('docType') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const active = !!(sp.get('q') || status || firm || docType || from || to);

  // Static classes only — Tailwind's JIT cannot see interpolated class names.
  const count = 3 + (statuses ? 1 : 0) + (firms ? 1 : 0) + (docTypes ? 1 : 0); // search + 2 dates + optionals
  const gridCls =
    count >= 6 ? 'xl:grid-cols-6'
    : count === 5 ? 'xl:grid-cols-5'
    : count === 4 ? 'xl:grid-cols-4'
    : 'xl:grid-cols-3';

  return (
    <div className="card mb-4 p-4">
      <div className={`grid gap-3 md:grid-cols-2 ${gridCls}`}>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Ico.files size={16} />
          </span>
          <input
            className="field-input pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Qidirish"
          />
        </div>

        {statuses && (
          <Select
            label="Holat"
            placeholder="Barcha holatlar"
            value={status}
            onChange={(v) => apply({ status: v })}
            options={[
              { value: '', label: 'Barcha holatlar' },
              ...statuses.map<Option>((s) => ({ value: s, label: STATUS_LABELS[s], dot: STATUS_DOT[s] })),
            ]}
          />
        )}

        {firms && (
          <Select
            label="Firma"
            placeholder="Barcha firmalar"
            value={firm}
            onChange={(v) => apply({ firm: v })}
            options={[
              { value: '', label: 'Barcha firmalar' },
              ...firms.map<Option>((f) => ({ value: f.id, label: f.shortName ?? f.name })),
            ]}
          />
        )}

        {docTypes && (
          <Select
            label="Hujjat turi"
            placeholder="Barcha turlar"
            value={docType}
            onChange={(v) => apply({ docType: v })}
            options={[
              { value: '', label: 'Barcha turlar' },
              ...docTypes.map<Option>((d) => ({ value: d, label: DOC_TYPE_SHORT[d] })),
            ]}
          />
        )}

        {/* Each end bounds the other, so an impossible range cannot be picked. */}
        <DatePicker
          value={from}
          onChange={(v) => apply({ from: v })}
          max={to || undefined}
          ariaLabel="Sanadan"
          placeholder="Sanadan"
        />
        <DatePicker
          value={to}
          onChange={(v) => apply({ to: v })}
          min={from || undefined}
          ariaLabel="Sanagacha"
          placeholder="Sanagacha"
        />
      </div>

      {active && (
        <button
          onClick={() => { setQ(''); router.push(pathname); }}
          className="mt-3 cursor-pointer text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          type="button"
        >
          Filtrlarni tozalash
        </button>
      )}
    </div>
  );
}
