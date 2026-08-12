import fs from 'node:fs/promises';
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
  if (!job) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });

  return NextResponse.json({
    status: job.status,
    progress: job.progress,
    total: job.total,
    message: job.message,
    resultPath: job.resultPath,
  });
}

/** Removes a finished export: deletes the ZIP file (best effort) and the Job row. */
export async function DELETE(_req: NextRequest, { params }: { params: { jobId: string } }) {
  await requireAdmin();

  const id = Number(params.jobId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });

  if (job.resultPath) {
    await fs.rm(path.join(process.cwd(), job.resultPath), { force: true }).catch(() => {});
  }
  await prisma.job.delete({ where: { id: job.id } });

  return NextResponse.json({ ok: true });
}
