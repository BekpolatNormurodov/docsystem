import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { runExportJob } from '@/lib/export-arizas';
import { buildLoanWhere, type LoanFilters } from '@/core/loan-filters';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  await requireAdmin();

  const body = await req.json();
  const date = String(body?.date ?? '');
  const q = body?.q ? String(body.q) : undefined;
  const branches = Array.isArray(body?.branches) && body.branches.length > 0
    ? body.branches.map(String)
    : undefined;
  const minDebt = body?.minDebt !== undefined && body?.minDebt !== null ? Number(body.minDebt) : undefined;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date notoʻgʻri (YYYY-MM-DD)' }, { status: 400 });
  }

  const reportDate = new Date(`${date}T00:00:00.000Z`);
  const snapshot = await prisma.snapshot.findUnique({ where: { reportDate } });
  if (!snapshot) return NextResponse.json({ error: 'Bu sana uchun snapshot topilmadi' }, { status: 404 });

  // minDebt is a CLIENT-total filter: the export produces one ariza per loan of the matching clients.
  const where = { ...buildLoanWhere(snapshot.id, { q, branches, page: 1 } satisfies LoanFilters), excluded: false };
  let total: number;
  if (minDebt) {
    const groups = await prisma.loan.groupBy({
      by: ['pinfl'],
      where,
      having: { totalDebt: { _sum: { gte: minDebt } } },
      _count: true,
    });
    total = groups.reduce((sum, g) => sum + g._count, 0);
  } else {
    total = await prisma.loan.count({ where });
  }

  const job = await prisma.job.create({
    data: {
      type: 'EXPORT',
      status: 'PENDING',
      snapshotId: snapshot.id,
      total,
      params: { snapshotId: snapshot.id, q, branches, minDebt },
    },
  });

  // Fire-and-forget: the server process carries this to completion; the client polls the Job.
  // The `.catch` is a final backstop — runExportJob already records failures on the Job row.
  void runExportJob(job.id, { snapshotId: snapshot.id, q, branches, minDebt }).catch(() => {});

  return NextResponse.json({ jobId: job.id, total });
}
