import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { attachAllScanned } from '@/lib/palata-attach';
import { reapStaleOcrJobs } from '@/lib/palata-ocr';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET → the latest «bazaga saqlash» (attach) job status, for progress polling.
export async function GET() {
  await requireUser();
  await reapStaleOcrJobs();
  const job = await prisma.job.findFirst({ where: { type: 'PALATA_ATTACH' }, orderBy: { id: 'desc' } });
  if (!job) return NextResponse.json({ job: null });
  return NextResponse.json({ job: { id: job.id, status: job.status, progress: job.progress, total: job.total, message: job.message } });
}

// POST → «Bazaga saqlash»: split every scanned ariza into its own signed-ariza PDF
// and attach it to the matching case (CaseDocument SIGNED_ARIZA), advancing the
// case to SIGNED_SCANNED. Idempotent — already-saved cases are skipped. Runs as a
// background Job so the request returns instantly; progress is polled via GET.
export async function POST() {
  await requireUser();
  await reapStaleOcrJobs();
  // Don't pile a manual catch-up on top of a live OCR (which itself attaches at the
  // end) or another attach run.
  const running = await prisma.job.findFirst({ where: { type: { in: ['PALATA_OCR', 'PALATA_ATTACH'] }, status: { in: ['PENDING', 'RUNNING'] } } });
  if (running) return NextResponse.json({ error: 'Jarayon allaqachon ishlayapti, kuting.' }, { status: 409 });

  const job = await prisma.job.create({ data: { type: 'PALATA_ATTACH', status: 'PENDING', total: 0, progress: 0 } });
  // Fire-and-forget: progress + result live on the Job row (polled via GET).
  void (async () => {
    await prisma.job.updateMany({ where: { id: job.id }, data: { status: 'RUNNING', message: 'Bazaga saqlanmoqda…' } });
    try {
      let lastAt = 0;
      const r = await attachAllScanned({
        onProgress: (d, t) => {
          if (d - lastAt >= 10 || d === t) { lastAt = d; prisma.job.updateMany({ where: { id: job.id }, data: { progress: d, total: Math.max(1, t) } }).catch(() => {}); }
        },
      });
      const msg = `${r.linked} bazaga saqlandi` + (r.already ? ` · ${r.already} avval saqlangan` : '') + (r.noCase ? ` · ${r.noCase} ish topilmadi` : '');
      await prisma.job.updateMany({ where: { id: job.id }, data: { status: 'DONE', progress: 1, total: 1, message: msg } });
      await audit(AuditAction.PALATA_SCAN, { target: 'palata:attach', detail: r });
    } catch (e) {
      await prisma.job.updateMany({ where: { id: job.id }, data: { status: 'FAILED', message: e instanceof Error ? e.message : 'Xatolik' } }).catch(() => {});
    }
  })();
  return NextResponse.json({ jobId: job.id });
}
