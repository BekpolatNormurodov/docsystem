import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { runMibReportJob } from '@/lib/mib/run';
import { getMibConfig } from '@/lib/mib/config';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST — GO: start (or resume) the durable automator for this report. Runs INLINE in the web process
// (long-lived loop), so it doesn't block the shared doc worker. Idempotent-ish: refuses if already
// running. It processes only PENDING clients, so pressing GO again after a restart resumes cleanly.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id }, select: { autoRun: true, total: true } });
  if (!report) return NextResponse.json({ error: 'Hisobot topilmadi' }, { status: 404 });
  if (report.autoRun) return NextResponse.json({ error: 'Allaqachon ishlayapti' }, { status: 409 });

  const pending = await prisma.mibClient.count({ where: { reportId: id, status: 'PENDING' } });
  if (pending === 0) return NextResponse.json({ error: 'Tekshiriladigan (PENDING) mijoz yo‘q' }, { status: 422 });

  const cfg = await getMibConfig();
  const job = await prisma.job.create({ data: { type: 'MIB_RUN', status: 'PENDING', total: pending, params: { reportId: id } } });
  await prisma.mibReport.update({ where: { id }, data: { autoRun: true, runJobId: job.id } });

  // Fire-and-forget inline loop. Resumable if the process dies (re-press GO).
  void runMibReportJob(job.id).catch(async () => {
    await prisma.mibReport.update({ where: { id }, data: { autoRun: false, runJobId: null } }).catch(() => {});
  });

  return NextResponse.json({ jobId: job.id, pending, phoneConfigured: !!cfg.phone, intervalSec: cfg.intervalSec });
}
