import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runAttachReceiptsJob, reapStaleReceiptJobs, receiptSummary } from '@/lib/hippo/attach-receipts';

export const runtime = 'nodejs';

// GET → latest receipt-attach job status (progress polling) + PER-FIRM summary when ?firmId= given
// (biriktirilgan/nomzod/qoldi — firma kesimida, DB'dan, doim aniq).
export async function GET(req: NextRequest) {
  await requireUser();
  await reapStaleReceiptJobs();
  const job = await prisma.job.findFirst({ where: { type: 'RECEIPT_ATTACH' }, orderBy: { id: 'desc' } });
  const jobOut = job ? { id: job.id, status: job.status, progress: job.progress, total: job.total, message: job.message } : null;

  const firmId = Number(req.nextUrl.searchParams.get('firmId'));
  let summary = null;
  if (Number.isInteger(firmId) && firmId > 0) {
    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, code: true } });
    if (firm) summary = await receiptSummary({ id: firm.id, code: firm.code });
  }
  return NextResponse.json({ job: jobOut, summary });
}

// POST { firmId } — «Cheklarni biriktirish»: start a BACKGROUND job that downloads the firm's
// talabnoma UZPOST receipts (checks) from xat.hippo and attaches each to its case. Progress lives
// on the Job row (polled via GET). Idempotent — re-runnable; the hippo sync also auto-attaches.
export async function POST(req: NextRequest) {
  await requireUser();
  await reapStaleReceiptJobs();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });

  const running = await prisma.job.findFirst({ where: { type: 'RECEIPT_ATTACH', status: { in: ['PENDING', 'RUNNING'] } } });
  if (running) return NextResponse.json({ jobId: running.id, already: true });

  const job = await prisma.job.create({ data: { type: 'RECEIPT_ATTACH', status: 'PENDING', total: 0, progress: 0 } });
  void runAttachReceiptsJob(job.id, firmId);
  return NextResponse.json({ jobId: job.id });
}
