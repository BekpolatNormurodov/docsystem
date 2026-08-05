import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState } from '@/ui';
import { formatSumDecimal } from '@/core/document';

export const dynamic = 'force-dynamic';

function ddmmyyyy(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export default async function HujjatlarPage() {
  await requireAdmin();

  const snapshots = await prisma.snapshot.findMany({
    where: { status: 'READY' },
    orderBy: { reportDate: 'desc' },
    select: { id: true, reportDate: true, rowCount: true, totalDebt: true },
  });

  // Per snapshot: how many clients/contracts are in the court list (excluded) and their total debt.
  const cards = await Promise.all(
    snapshots.map(async (s) => {
      const [agg, exClients] = await Promise.all([
        prisma.loan.aggregate({ where: { snapshotId: s.id, excluded: true }, _count: true, _sum: { totalDebt: true } }),
        prisma.loan.groupBy({ by: ['pinfl'], where: { snapshotId: s.id, excluded: true } }),
      ]);
      return {
        date: s.reportDate.toISOString().slice(0, 10),
        reportDate: s.reportDate,
        rowCount: s.rowCount,
        totalDebt: s.totalDebt,
        exLoans: agg._count,
        exDebt: agg._sum.totalDebt ?? 0,
        exClients: exClients.length,
      };
    }),
  );

  return (
    <div>
      <PageHeader title="Hujjatlar" subtitle="Sanani tanlang — sud roʻyxatidagilarga ariza (.docx) ZIP qilib yuklab oling" />

      {cards.length === 0 ? (
        <EmptyState
          title="Hali portfel yuklanmagan"
          hint="Import boʻlimidan portfel + istisno faylini yuklang, keyin shu yerda sana kartalari paydo boʻladi."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link
              key={c.date}
              href={`/hujjatlar/${c.date}`}
              className="card group flex flex-col gap-3 p-5 transition hover:border-brand-500/50 hover:shadow-glow"
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">{ddmmyyyy(c.reportDate)}</span>
                <span className="text-brand-600 transition group-hover:translate-x-0.5">→</span>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                <div>
                  <div className="text-[11px] text-muted">Portfel — kreditlar</div>
                  <div className="text-sm font-semibold">{c.rowCount.toLocaleString('ru-RU')}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-muted">Jami qarz</div>
                  <div className="text-sm font-semibold">{formatSumDecimal(String(c.totalDebt))} soʻm</div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  ⚖ Sud roʻyxati (ariza chiqadi)
                </div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <span className="text-sm">
                    <span className="font-bold">{c.exClients.toLocaleString('ru-RU')}</span> mijoz ·{' '}
                    <span className="font-bold">{c.exLoans.toLocaleString('ru-RU')}</span> shartnoma
                  </span>
                  <span className="text-sm font-bold text-amber-700 dark:text-amber-300">
                    {formatSumDecimal(String(c.exDebt))} soʻm
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
