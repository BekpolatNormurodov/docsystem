import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export const runtime = 'nodejs';

// requireUser (not requireAdmin): a yurist granted a bulk step (e.g. «sud:oferta») starts jobs via the
// requireUser prepare-* routes, so they must also be able to POLL and CANCEL them here — otherwise the
// job runs but its progress/cancel is 403 for the yurist and the feature looks broken («dostup yo'q»).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();

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

// POST — «Bekor»: cancel a queued/running bulk job. A PENDING job (not yet claimed) is marked
// CANCELED outright so no worker ever runs it; a RUNNING job gets cancelRequested=true and its own
// batch loop aborts at the next checkpoint — stops rendering, deletes the half-built ZIP, sets
// CANCELED. Terminal jobs (DONE/FAILED/CANCELED) are left as-is. Both writes are status-guarded so
// a job that flips PENDING→RUNNING between the two updates is still handled correctly.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });

  const pending = await prisma.job.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELED', message: 'Bekor qilindi' } });
  if (pending.count > 0) return NextResponse.json({ status: 'CANCELED' });

  const running = await prisma.job.updateMany({ where: { id, status: 'RUNNING' }, data: { cancelRequested: true } });
  if (running.count > 0) return NextResponse.json({ status: 'CANCELING' });

  const job = await prisma.job.findUnique({ where: { id }, select: { status: true } });
  if (!job) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  return NextResponse.json({ status: job.status });
}
