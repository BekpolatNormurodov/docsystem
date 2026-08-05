import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/ui';
import { ExportForm } from './ExportForm';

export const dynamic = 'force-dynamic';

export default async function HujjatlarPage() {
  await requireAdmin();

  const [snapshots, firms] = await Promise.all([
    prisma.snapshot.findMany({
      where: { status: 'READY' },
      select: { reportDate: true },
      orderBy: { reportDate: 'desc' },
    }),
    prisma.firm.findMany({ orderBy: { shortName: 'asc' }, select: { code: true, shortName: true } }),
  ]);

  const dates = snapshots.map((s) => s.reportDate.toISOString().slice(0, 10));

  return (
    <div>
      <PageHeader title="Hujjatlar" subtitle="Arizalarni ommaviy .docx ZIP holida yuklab oling" />
      <ExportForm dates={dates} firms={firms} />
    </div>
  );
}
