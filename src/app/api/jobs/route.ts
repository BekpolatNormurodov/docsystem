import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// GET ?limit=&type= — recent background batches (Job rows): talabnoma PDF / ariza-paket / oferta /
// import. For the «Partiyalar tarixi» view. Enriches each with its firm name (from params.firmId).
export async function GET(req: NextRequest) {
  await requireUser();
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
  const type = req.nextUrl.searchParams.get('type') || undefined;

  const jobs = await prisma.job.findMany({
    where: type ? { type } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, type: true, status: true, progress: true, total: true, message: true, resultPath: true, params: true, snapshotId: true, createdAt: true, updatedAt: true },
  });

  // Firm names (params.firmId → shortName).
  const firmIds = [...new Set(jobs.map((j) => Number((j.params as any)?.firmId)).filter((n) => Number.isInteger(n) && n > 0))];
  const firms = firmIds.length ? await prisma.firm.findMany({ where: { id: { in: firmIds } }, select: { id: true, shortName: true } }) : [];
  const nameById = new Map(firms.map((f) => [f.id, f.shortName]));

  const rows = jobs.map((j) => {
    const p = (j.params ?? {}) as any;
    const fid = Number(p.firmId);
    return {
      id: j.id,
      type: j.type,
      status: j.status,
      progress: j.progress,
      total: j.total,
      message: j.message,
      hasResult: !!j.resultPath,
      firmName: Number.isInteger(fid) && fid > 0 ? (nameById.get(fid) ?? `firma ${fid}`) : 'Hamma firma',
      arizaOnly: p.arizaOnly === true,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
    };
  });
  return NextResponse.json({ jobs: rows });
}
