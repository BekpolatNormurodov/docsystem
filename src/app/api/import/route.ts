import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { runImportJob } from '@/lib/jobs';

export const runtime = 'nodejs';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

export async function POST(req: NextRequest) {
  await requireAdmin();

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const excludeFile = form.get('exclude') as File | null;
  const date = String(form.get('date') ?? '');

  if (!file) return NextResponse.json({ error: 'file majburiy' }, { status: 400 });
  if (!excludeFile) return NextResponse.json({ error: 'exclude majburiy' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date notoʻgʻri (YYYY-MM-DD)' }, { status: 400 });
  }

  const reportDate = new Date(`${date}T00:00:00.000Z`);

  // Concurrency guard: never delete a snapshot that is still importing. Two imports racing on the
  // same date previously deleted each other's in-flight snapshot, causing FK violations on the
  // loan inserts. If an import for this date is already running, reject; otherwise replace.
  const existing = await prisma.snapshot.findUnique({ where: { reportDate } });
  if (existing?.status === 'IMPORTING') {
    // Only block if an import job for this snapshot is genuinely still progressing. A job orphaned
    // by a server restart leaves the snapshot stuck IMPORTING forever; treat a stale one (no job
    // update in 90s) as dead and allow replacing it, so a date never gets permanently locked.
    const liveJob = await prisma.job.findFirst({
      where: { snapshotId: existing.id, type: 'IMPORT', status: 'RUNNING' },
      orderBy: { id: 'desc' },
      select: { updatedAt: true },
    });
    const stillRunning = liveJob && Date.now() - liveJob.updatedAt.getTime() < 90_000;
    if (stillRunning) {
      return NextResponse.json(
        { error: 'Bu sana uchun import hozir ketyapti. Tugashini kuting yoki boshqa sana tanlang.' },
        { status: 409 },
      );
    }
  }
  // Wrap the replace+create: two same-date POSTs racing here would otherwise have the
  // loser throw an uncaught P2002 (unique reportDate) or P2025 (row already deleted) → 500.
  // Files are written only AFTER a successful create, so a failure here orphans nothing.
  let snapshot;
  try {
    if (existing) {
      // Replace semantics: a finished (READY/FAILED) snapshot for this date is dropped (loans cascade).
      await prisma.snapshot.delete({ where: { id: existing.id } });
    }
    snapshot = await prisma.snapshot.create({
      data: { reportDate, sourceFileName: file.name, status: 'IMPORTING' },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002' || (e as { code?: string })?.code === 'P2025') {
      return NextResponse.json({ error: 'Bu sana uchun import boshqa jarayonda ketyapti. Qayta urinib koʻring.' }, { status: 409 });
    }
    throw e;
  }

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filePath = path.join(UPLOADS_DIR, `${snapshot.id}.xlsx`);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  const excludePath = path.join(UPLOADS_DIR, `${snapshot.id}-exclude.xlsx`);
  await fs.writeFile(excludePath, Buffer.from(await excludeFile.arrayBuffer()));

  // Seed an estimated row total (~820 bytes/row in these portfolios) so the client can show a real
  // percentage while streaming — the exact count is only known when the stream finishes.
  const estimatedRows = Math.max(1, Math.round(file.size / 820));
  const job = await prisma.job.create({
    data: { type: 'IMPORT', status: 'PENDING', snapshotId: snapshot.id, total: estimatedRows },
  });

  // Fire-and-forget: the server process carries this to completion; the client polls the Job.
  // The `.catch` is a final backstop — runImportJob already records failures on the rows.
  void runImportJob(job.id, filePath, snapshot.id, excludePath).catch(() => {});

  return NextResponse.json({ jobId: job.id, snapshotId: snapshot.id });
}
