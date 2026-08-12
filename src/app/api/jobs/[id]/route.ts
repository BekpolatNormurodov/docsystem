import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });

  return NextResponse.json({
    status: job.status,
    progress: job.progress,
    total: job.total,
    message: job.message,
    snapshotId: job.snapshotId,
  });
}
