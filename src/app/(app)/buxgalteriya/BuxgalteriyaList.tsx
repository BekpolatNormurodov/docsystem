'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BxData, BxFirm, BxRow } from '@/lib/buxgalteriya';
import { InvoiceExcelTools } from '../konveyer/InvoiceExcelTools';

const n = (x: number) => x.toLocaleString('ru-RU');

function FirmCard({ firm, query, forceOpen }: { firm: BxFirm; query: string; forceOpen: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<BxRow[]>(firm.rows);
  // Server qayta render qilganда (router.refresh, masalan import'dan keyin) yangi ma'lumotга sinxron.
  useEffect(() => { setRows(firm.rows); }, [firm.rows]);
  const [busy, setBusy] = useState<number | null>(null);
  const [openState, setOpen] = useState(false);
  const open = forceOpen || openState;
  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => [r.clientName, r.receiptNumber, r.invoiceNo, r.kod].some((v) => (v ?? '').toLowerCase().includes(q)))
    : rows;
  if (q && visible.length === 0) return null; // qidiruvda mos qatori yo'q firma — yashiramiz

  const paid = rows.filter((r) => r.paid).length;
  const unpaid = rows.length - paid;
  const paidSum = rows.filter((r) => r.paid).reduce((s, r) => s + r.amount, 0);
  const unpaidSum = rows.filter((r) => !r.paid).reduce((s, r) => s + r.amount, 0);
  const sum = paidSum + unpaidSum;

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
          <span className="whitespace-nowrap text-xs font-bold tabular-nums text-brand-700 dark:text-brand-300">{n(sum)} so‘m</span>
          <a href={`/buxgalteriya/farmoyish?firmId=${firm.firmId}`} onClick={(e) => e.stopPropagation()} className="hidden rounded-md border border-line px-2 py-1 text-[11px] font-medium text-sky-700 hover:border-sky-500/40 dark:text-sky-300 sm:inline-flex" title="Farmoyish (Word)">Word</a>
          <a href={`/buxgalteriya/excel?firmId=${firm.firmId}`} onClick={(e) => e.stopPropagation()} className="hidden rounded-md border border-line px-2 py-1 text-[11px] font-medium text-emerald-700 hover:border-emerald-500/40 dark:text-emerald-300 sm:inline-flex" title="Excel">Excel</a>
          <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-surface-2/30 px-4 py-2 text-[11px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">To‘langan: <b>{n(paid)}</b> · {n(paidSum)} so‘m</span>
            <span className="text-amber-600 dark:text-amber-400">To‘lanmagan: <b>{n(unpaid)}</b> · {n(unpaidSum)} so‘m</span>
            <span className="ml-auto font-semibold">Jami: {n(sum)} so‘m</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/40 text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 text-left font-semibold">Mijoz</th>
                  <th className="px-4 py-2 text-left font-semibold">Kvitansiya raqami</th>
                  <th className="px-4 py-2 text-left font-semibold">Invoice raqami</th>
                  <th className="px-4 py-2 text-right font-semibold">Summa</th>
                  <th className="px-4 py-2 text-right font-semibold">Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((r) => (
                  <tr key={r.caseId} className="hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.clientName || '—'}</div>
                      {r.kod && <div className="text-[11px] text-muted">{r.kod}</div>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs tabular-nums">{r.receiptNumber || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs tabular-nums text-muted">{r.invoiceNo || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{n(r.amount)}</td>
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

export function BuxgalteriyaList({ data, snapshotId }: { data: BxData; snapshotId?: number }) {
  const router = useRouter();
  const [sel, setSel] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');

  if (data.firms.length === 0) {
    return <div className="card grid h-40 place-items-center text-center text-sm text-muted">Bu sana bo‘yicha yaratilgan invoice yo‘q.<br />Mohigul «Invoice yaratish»da boji yaratgach shu yerda ko‘rinadi.</div>;
  }
  const shown = sel === 'all' ? data.firms : data.firms.filter((f) => f.firmId === sel);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_16rem]">
      {/* Chap: umumiy hisobot + qidiruv + firma kartalari */}
      <div className="min-w-0 space-y-3">
        {/* Hammasi bo'yicha yuklab olish: firma tanlangan bo'lsa — o'sha firma, bo'lmasa hammasi (ZIP/Excel) */}
        <div className="flex flex-wrap items-center gap-2">
          <a href={sel === 'all' ? '/buxgalteriya/farmoyish' : `/buxgalteriya/farmoyish?firmId=${sel}`} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-500/15 dark:text-sky-300">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
            Farmoyish (Word){sel === 'all' ? ' — hammasi (ZIP)' : ''}
          </a>
          <a href={sel === 'all' ? '/buxgalteriya/excel' : `/buxgalteriya/excel?firmId=${sel}`} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /></svg>
            Excel{sel === 'all' ? ' — hammasi' : ''}
          </a>
          {/* Excel’dan to‘lov holatini import (reconcile) — avval sonlar, tasdiqdan keyin saqlaydi */}
          <InvoiceExcelTools snapshotId={snapshotId} count={data.total} firms={data.firms.map((f) => ({ id: f.firmId, name: f.firmName }))} onChanged={() => router.refresh()} showExport={false} />
          {sel !== 'all' && <span className="text-[11px] text-muted">(tanlangan firma bo‘yicha)</span>}
        </div>

        {/* Umumiy hisobot — soni va HAQIQIY summasi bilan */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="card p-4"><div className="text-xs text-muted">Jami kvitansiya</div><div className="mt-0.5 text-xl font-bold tabular-nums">{n(data.total)}</div><div className="text-[11px] tabular-nums text-muted">{n(data.sum)} so‘m</div></div>
          <div className="card p-4"><div className="text-xs text-muted">To‘langan</div><div className="mt-0.5 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{n(data.paidCount)}</div><div className="text-[11px] tabular-nums text-emerald-600/80 dark:text-emerald-400/80">{n(data.paidSum)} so‘m</div></div>
          <div className="card p-4"><div className="text-xs text-muted">To‘lanmagan</div><div className="mt-0.5 text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{n(data.unpaidCount)}</div><div className="text-[11px] tabular-nums text-amber-600/80 dark:text-amber-400/80">{n(data.unpaidSum)} so‘m</div></div>
        </div>

        {/* Qidiruv — mijoz F.I.Sh / kvitansiya / invoice raqami / kod bo'yicha */}
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Qidirish: mijoz, kvitansiya yoki invoice raqami, kod…"
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
        </div>

        {shown.map((f) => <FirmCard key={f.firmId} firm={f} query={q} forceOpen={q.trim().length > 0} />)}
      </div>

      {/* O'ng: firmalar ro'yxati (filtr) — soni va summasi bilan */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="card p-2">
          <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Firmalar</div>
          <ul className="space-y-0.5">
            <li>
              <button onClick={() => setSel('all')} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${sel === 'all' ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'hover:bg-surface-2'}`}>
                <span className="text-[13px] font-semibold">Hammasi</span>
                <span className="shrink-0 text-right"><span className="block text-[11px] tabular-nums text-muted">{n(data.paidCount)}/{n(data.total)}</span><span className="block text-[10px] tabular-nums text-muted">{n(data.sum)}</span></span>
              </button>
            </li>
            {data.firms.map((f) => (
              <li key={f.firmId}>
                <button onClick={() => setSel(f.firmId)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${sel === f.firmId ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'hover:bg-surface-2'}`}>
                  <span className="min-w-0 truncate text-[13px]">{f.firmName}</span>
                  <span className="shrink-0 text-right"><span className="block text-[11px] tabular-nums text-muted">{n(f.paid)}/{n(f.total)}</span><span className="block text-[10px] tabular-nums text-muted">{n(f.sum)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
