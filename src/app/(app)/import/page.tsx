import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/ui';
import { ImportForm } from './ImportForm';
import { ImportHistory, type HistoryRow } from './ImportHistory';

export const dynamic = 'force-dynamic';

const pretty = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};
const when = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${pretty(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default async function ImportPage() {
  await requireAdmin();

  const snapshots = await prisma.snapshot.findMany({
    orderBy: { importedAt: 'desc' },
    select: { id: true, reportDate: true, sourceFileName: true, status: true, rowCount: true, processedRows: true, totalDebt: true, importedAt: true },
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
      pretty: pretty(s.reportDate),
      fileName: s.sourceFileName,
      status: s.status,
      rows: s.status === 'READY' ? s.rowCount : s.processedRows,
      totalDebt: String(s.totalDebt),
      importedAt: when(s.importedAt),
      pct,
    };
  });

  return (
    <div>
      <PageHeader title="Import" subtitle="Portfel faylini yuklang" />
      <ImportForm />

      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted">Yuklangan portfellar</h2>
      <ImportHistory rows={rows} />
    </div>
  );
}
