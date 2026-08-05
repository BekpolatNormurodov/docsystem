import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/ui';
import { ExportPanel } from './ExportPanel';

export const dynamic = 'force-dynamic';

export default async function HujjatlarDatePage({ params }: { params: { date: string } }) {
  await requireAdmin();
  const date = params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const snapshot = await prisma.snapshot.findUnique({
    where: { reportDate: new Date(`${date}T00:00:00.000Z`) },
  });
  if (!snapshot) notFound();

  // Firms that actually have loans in this snapshot, with a per-firm count for the chips.
  const [grouped, firms] = await Promise.all([
    prisma.loan.groupBy({ by: ['branchCode'], where: { snapshotId: snapshot.id }, _count: true }),
    prisma.firm.findMany({ select: { code: true, shortName: true } }),
  ]);
  const nameByCode = new Map(firms.map((f) => [f.code, f.shortName]));
  const firmChips = grouped
    .filter((g) => g.branchCode)
    .map((g) => ({
      code: g.branchCode as string,
      name: nameByCode.get(g.branchCode as string) ?? (g.branchCode as string),
      count: g._count,
    }))
    .sort((a, b) => b.count - a.count);

  const pretty = date.split('-').reverse().join('.');

  return (
    <div>
      <Link href="/hujjatlar" className="mb-3 inline-block text-sm text-muted hover:text-fg">
        ← Sanalar
      </Link>
      <PageHeader
        title={`Hujjatlar — ${pretty}`}
        subtitle="Firmalarni tanlang (2–3 ta ham boʻladi), kerak boʻlsa filtr qoʻshing va ZIP yarating"
      />
      <ExportPanel date={date} firms={firmChips} />
    </div>
  );
}
