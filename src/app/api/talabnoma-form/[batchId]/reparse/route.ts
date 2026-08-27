import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { enqueueJob } from '@/lib/job-dispatch';

export const runtime = 'nodejs';

// POST — re-run the parse for a batch whose analysis stalled (e.g. the dev server reloaded mid-parse).
// The uploaded Excels are already on disk, so this just resets progress and enqueues a fresh parse job.
export async function POST(_req: NextRequest, { params }: { params: { batchId: string } }) {
  await requireAccess('talabnoma-form');
  const id = Number(params.batchId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'batchId noto‘g‘ri' }, { status: 400 });
  const batch = await prisma.talabnomaFormBatch.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!batch) return NextResponse.json({ error: 'Batch topilmadi' }, { status: 404 });
  if (batch.status === 'READY') return NextResponse.json({ error: 'Batch allaqachon tayyor' }, { status: 409 });

  await prisma.talabnomaFormBatch.update({
    where: { id },
    data: { status: 'PARSING', processedRows: 0, totalRows: 0, message: null },
  });
  const job = await prisma.job.create({
    data: { type: 'TALABNOMA_FORM', status: 'PENDING', total: 1, params: { action: 'parse', batchId: id } },
  });
  enqueueJob(job.id);
  return NextResponse.json({ jobId: job.id });
}
