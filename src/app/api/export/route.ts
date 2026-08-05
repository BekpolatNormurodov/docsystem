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
  const onlyExcluded = body?.onlyExcluded === true;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date notoʻgʻri (YYYY-MM-DD)' }, { status: 400 });
  }

  const reportDate = new Date(`${date}T00:00:00.000Z`);
  const snapshot = await prisma.snapshot.findUnique({ where: { reportDate } });
  if (!snapshot) return NextResponse.json({ error: 'Bu sana uchun snapshot topilmadi' }, { status: 404 });

  // minDebt is a CLIENT-total filter: the export produces one ariza per loan of the matching clients.
  const where = { ...buildLoanWhere(snapshot.id, { q, branches, page: 1 } satisfies LoanFilters), excluded: onlyExcluded };
  // One ariza per (client × firm), so the total is the number of distinct (pinfl, branchCode) groups.
  const arizaGroups = await prisma.loan.groupBy({ by: ['pinfl', 'branchCode'], where });
  let total: number;
  if (minDebt) {
    const allowed = new Set(
      (await prisma.loan.groupBy({ by: ['pinfl'], where, having: { totalDebt: { _sum: { gte: minDebt } } } }))
        .map((g) => g.pinfl)
        .filter((p): p is string => !!p),
    );
    total = arizaGroups.filter((g) => g.pinfl && allowed.has(g.pinfl)).length;
  } else {
    total = arizaGroups.length;
  }

  const job = await prisma.job.create({
    data: {
      type: 'EXPORT',
      status: 'PENDING',
      snapshotId: snapshot.id,
      total,
      params: { snapshotId: snapshot.id, q, branches, minDebt, onlyExcluded },
    },
  });

  // Fire-and-forget: the server process carries this to completion; the client polls the Job.
  // The `.catch` is a final backstop — runExportJob already records failures on the Job row.
  void runExportJob(job.id, { snapshotId: snapshot.id, q, branches, minDebt, onlyExcluded }).catch(() => {});

  return NextResponse.json({ jobId: job.id, total });
}
