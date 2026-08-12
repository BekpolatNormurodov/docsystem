import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  await requireAdmin();

  const id = Number(params.jobId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.status !== 'DONE' || !job.resultPath) {
    return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  }

  const zipPath = path.join(process.cwd(), job.resultPath);
  if (!fs.existsSync(zipPath)) {
    return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  }

  const snapshot = job.snapshotId ? await prisma.snapshot.findUnique({ where: { id: job.snapshotId } }) : null;
  const dateStr = snapshot ? snapshot.reportDate.toISOString().slice(0, 10) : String(job.id);

  const stat = fs.statSync(zipPath);
  const stream = fs.createReadStream(zipPath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="arizalar-${dateStr}.zip"`,
      'Content-Length': String(stat.size),
    },
  });
}
