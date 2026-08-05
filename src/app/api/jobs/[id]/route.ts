import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();

  const job = await prisma.job.findUnique({ where: { id: Number(params.id) } });
  if (!job) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });

  return NextResponse.json({
    status: job.status,
    progress: job.progress,
    total: job.total,
    message: job.message,
    snapshotId: job.snapshotId,
  });
}
