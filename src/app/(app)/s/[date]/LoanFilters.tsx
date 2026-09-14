'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Select, TextField, DateField } from '@/ui';
import type { Option } from '@/ui/Select';
import { useT } from '@/lib/i18n/client';

export type FirmOpt = { code: string; shortName: string };

/**
 * URL-driven filter bar for the loan table — mirrors spravka's `Filters` but scoped to the
 * fields `parseLoanFilters`/`buildLoanWhere` understand: q, branch, minDebt, fromDate.
 */
export function LoanFilters({ firms }: { firms: FirmOpt[] }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [q, setQ] = useState(sp.get('q') ?? '');
  const [branch, setBranch] = useState(sp.get('branch') ?? '');
  const [minDebt, setMinDebt] = useState(sp.get('minDebt') ?? '');
  const [fromDate, setFromDate] = useState(sp.get('fromDate') ?? '');

  const active = !!(sp.get('q') || sp.get('branch') || sp.get('minDebt') || sp.get('fromDate'));

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (branch) params.set('branch', branch);
    if (minDebt) params.set('minDebt', minDebt);
    if (fromDate) params.set('fromDate', fromDate);
    // Any filter change resets to page 1.
    router.push(`${pathname}?${params.toString()}`);
  }

  function clear() {
    setQ('');
    setBranch('');
    setMinDebt('');
    setFromDate('');
    router.push(pathname);
  }

  return (
    <form onSubmit={apply} className="card mb-4 p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <TextField
          label={t('Qidirish')}
          value={q}
          onChange={setQ}
          placeholder={t('PINFL, F.I.SH., shartnoma…')}
        />
        <Select
          label={t('Firma')}
          placeholder={t('Barcha firmalar')}
          value={branch}
          onChange={setBranch}
          options={[
            { value: '', label: t('Barcha firmalar') },
            ...firms.map<Option>((f) => ({ value: f.code, label: f.shortName })),
          ]}
        />
        <TextField
          label={t('Qarz ≥')}
          value={minDebt}
          onChange={setMinDebt}
          inputMode="numeric"
          placeholder="0"
        />
        <DateField label={t('Sanadan')} value={fromDate} onChange={setFromDate} />
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-primary w-full">{t('Filtrlash')}</button>
        </div>
      </div>

      {active && (
        <button
          onClick={clear}
          type="button"
          className="mt-3 cursor-pointer text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('Filtrlarni tozalash')}
        </button>
      )}
    </form>
  );
}
