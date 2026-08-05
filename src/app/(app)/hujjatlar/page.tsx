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
    select: { reportDate: true, rowCount: true, totalDebt: true },
  });

  return (
    <div>
      <PageHeader title="Hujjatlar" subtitle="Sanani tanlang — arizalarni firma boʻyicha ajratib .docx ZIP qilib yuklab oling" />

      {snapshots.length === 0 ? (
        <EmptyState
          title="Hali portfel yuklanmagan"
          hint="Import boʻlimidan portfel faylini yuklang, keyin shu yerda sana kartalari paydo boʻladi."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {snapshots.map((s) => {
            const date = s.reportDate.toISOString().slice(0, 10);
            return (
              <Link
                key={date}
                href={`/hujjatlar/${date}`}
                className="card group flex flex-col gap-3 p-5 transition hover:border-brand-500/50 hover:shadow-glow"
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">{ddmmyyyy(s.reportDate)}</span>
                  <span className="text-brand-600 transition group-hover:translate-x-0.5">→</span>
                </div>
                <div className="flex items-end justify-between border-t border-line pt-3">
                  <div>
                    <div className="text-xs text-muted">Kreditlar</div>
                    <div className="text-sm font-semibold">{s.rowCount.toLocaleString('ru-RU')}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted">Jami qarz</div>
                    <div className="text-sm font-semibold">{formatSumDecimal(String(s.totalDebt))}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
