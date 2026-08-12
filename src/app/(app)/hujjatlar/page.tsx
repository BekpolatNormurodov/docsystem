import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState } from '@/ui';
import { formatSumDecimal } from '@/core/document';
import { ImportPanel } from './ImportPanel';
import { ImportForm } from './ImportForm';
import { ImportHistory, type HistoryRow } from './ImportHistory';

export const dynamic = 'force-dynamic';

function ddmmyyyy(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}
// UTC throughout — mixing local get*() with the UTC date above would show a time that
// disagrees with the date by the server's timezone offset.
function when(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ddmmyyyy(d)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export default async function HujjatlarPage() {
  await requireAdmin();

  // One fetch drives both sections: every snapshot feeds the import history (any status),
  // and the READY ones also become the date cards below.
  const snapshots = await prisma.snapshot.findMany({
    orderBy: { importedAt: 'desc' },
    select: {
      id: true,
      reportDate: true,
      sourceFileName: true,
      status: true,
      rowCount: true,
      processedRows: true,
      totalDebt: true,
      importedAt: true,
    },
  });

  // Live percentage for in-progress imports: the latest IMPORT job holds progress/total.
  const importingIds = snapshots.filter((s) => s.status === 'IMPORTING').map((s) => s.id);
  const jobs = importingIds.length
    ? await prisma.job.findMany({
        where: { type: 'IMPORT', snapshotId: { in: importingIds } },
        orderBy: { id: 'desc' },
        select: { snapshotId: true, progress: true, total: true },
      })
    : [];
  const jobBySnap = new Map<number, { progress: number; total: number }>();
  for (const j of jobs) {
    if (j.snapshotId != null && !jobBySnap.has(j.snapshotId)) jobBySnap.set(j.snapshotId, { progress: j.progress, total: j.total });
  }

  const rows: HistoryRow[] = snapshots.map((s) => {
    let pct: number | null = null;
    if (s.status === 'IMPORTING') {
      const j = jobBySnap.get(s.id);
      pct = j && j.total > 0 ? Math.min(99, Math.round((j.progress / j.total) * 100)) : 0;
    }
    return {
      id: s.id,
      date: s.reportDate.toISOString().slice(0, 10),
      pretty: ddmmyyyy(s.reportDate),
      fileName: s.sourceFileName,
      status: s.status,
      rows: s.status === 'READY' ? s.rowCount : s.processedRows,
      totalDebt: String(s.totalDebt),
      importedAt: when(s.importedAt),
      pct,
    };
  });

  // READY snapshots → date cards. Per snapshot: court-list (excluded) clients/contracts/debt
  // in one COUNT(DISTINCT) query each, so tab navigation never transfers the ~1054 pinfl rows.
  const readySnaps = snapshots
    .filter((s) => s.status === 'READY')
    .sort((a, b) => b.reportDate.getTime() - a.reportDate.getTime());
  const cards = await Promise.all(
    readySnaps.map(async (s) => {
      const [row] = await prisma.$queryRaw<{ loans: bigint; debt: string | null; clients: bigint }[]>`
        SELECT COUNT(*) AS loans, SUM(totalDebt) AS debt, COUNT(DISTINCT pinfl) AS clients
        FROM Loan WHERE snapshotId = ${s.id} AND excluded = 1`;
      return {
        date: s.reportDate.toISOString().slice(0, 10),
        reportDate: s.reportDate,
        rowCount: s.rowCount,
        totalDebt: s.totalDebt,
        exLoans: Number(row?.loans ?? 0),
        exDebt: row?.debt ?? 0,
        exClients: Number(row?.clients ?? 0),
      };
    }),
  );

  return (
    <div>
      <PageHeader
        title="Hujjatlar"
        subtitle="Portfel yuklang, soʻng sanani tanlab sud roʻyxatidagilarga ariza (.docx) ZIP qilib oling"
      />

      <ImportPanel defaultOpen={cards.length === 0} count={rows.length}>
        <ImportForm />
        <ImportHistory rows={rows} />
      </ImportPanel>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted">Sana boʻyicha hujjatlar</h2>

      {cards.length === 0 ? (
        <EmptyState
          title="Hali portfel yuklanmagan"
          hint="Yuqoridagi «Portfel import» panelidan portfel + istisno faylini yuklang, keyin shu yerda sana kartalari paydo boʻladi."
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
