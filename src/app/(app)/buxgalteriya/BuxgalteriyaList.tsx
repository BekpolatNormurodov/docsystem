'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BxData, BxFirm, BxRow } from '@/lib/buxgalteriya';

const n = (x: number) => x.toLocaleString('ru-RU');

function FirmCard({ firm, amount }: { firm: BxFirm; amount: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<BxRow[]>(firm.rows);
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const paid = rows.filter((r) => r.paid).length;
  const unpaid = rows.length - paid;

  const toggle = async (row: BxRow) => {
    if (row.locked) return;
    setBusy(row.caseId);
    try {
      const res = await fetch('/buxgalteriya/mark', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: row.caseId, paid: !row.paid }),
      });
      if (res.ok) {
        setRows((rs) => rs.map((r) => (r.caseId === row.caseId ? { ...r, paid: !r.paid } : r)));
        router.refresh();
      }
    } finally { setBusy(null); }
  };

  return (
    <section className="card p-0">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{firm.firmName}</div>
          <div className="mt-0.5 text-[11px] tabular-nums text-muted">
            {n(rows.length)} kvitansiya · <span className="font-medium text-emerald-600 dark:text-emerald-400">{n(paid)} to‘langan</span> · <span className="font-medium text-amber-600 dark:text-amber-400">{n(unpaid)} to‘lanmagan</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-xs font-bold tabular-nums text-brand-700 dark:text-brand-300">{n(rows.length * amount)} so‘m</span>
          <a href={`/buxgalteriya/excel?firmId=${firm.firmId}`} onClick={(e) => e.stopPropagation()} className="hidden rounded-md border border-line px-2 py-1 text-[11px] font-medium text-emerald-700 hover:border-emerald-500/40 dark:text-emerald-300 sm:inline-flex" title="Excel">Excel</a>
          <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-surface-2/30 px-4 py-2 text-[11px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">To‘langan: <b>{n(paid)}</b> · {n(paid * amount)} so‘m</span>
            <span className="text-amber-600 dark:text-amber-400">To‘lanmagan: <b>{n(unpaid)}</b> · {n(unpaid * amount)} so‘m</span>
            <span className="ml-auto font-semibold">Jami: {n(rows.length * amount)} so‘m</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/40 text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 text-left font-semibold">Mijoz</th>
                  <th className="px-4 py-2 text-left font-semibold">Kvitansiya raqami</th>
                  <th className="px-4 py-2 text-right font-semibold">Summa</th>
                  <th className="px-4 py-2 text-right font-semibold">Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.caseId} className="hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.clientName || '—'}</div>
                      {r.kod && <div className="text-[11px] text-muted">{r.kod}</div>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs tabular-nums">{r.receiptNumber || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{n(amount)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => void toggle(r)}
                        disabled={busy === r.caseId || r.locked}
                        aria-pressed={r.paid}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                          r.paid
                            ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300'
                            : 'border border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'
                        }`}
                        title={r.locked ? 'Keyingi bosqichga o‘tgan' : r.paid ? 'To‘langan (qaytarish uchun bosing)' : 'To‘landi deb belgilash'}
                      >
                        {busy === r.caseId ? '…' : r.paid ? '✓ To‘langan' : 'To‘landi'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export function BuxgalteriyaList({ data }: { data: BxData }) {
  if (data.firms.length === 0) {
    return <div className="card grid h-40 place-items-center text-center text-sm text-muted">Bu sana bo‘yicha yaratilgan invoice yo‘q.<br />Mohigul «Invoice yaratish»da boji yaratgach shu yerda ko‘rinadi.</div>;
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="text-xs text-muted">Jami kvitansiya</div><div className="mt-0.5 text-xl font-bold tabular-nums">{n(data.total)}</div></div>
        <div className="card p-4"><div className="text-xs text-muted">To‘langan</div><div className="mt-0.5 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{n(data.paidCount)}</div></div>
        <div className="card p-4"><div className="text-xs text-muted">To‘lanmagan</div><div className="mt-0.5 text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{n(data.unpaidCount)}</div></div>
      </div>
      {data.firms.map((f) => <FirmCard key={f.firmId} firm={f} amount={data.amount} />)}
    </div>
  );
}
