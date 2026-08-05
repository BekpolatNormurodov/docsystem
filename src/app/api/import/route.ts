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
  const date = String(form.get('date') ?? '');

  if (!file) return NextResponse.json({ error: 'file majburiy' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date notoʻgʻri (YYYY-MM-DD)' }, { status: 400 });
  }

  const reportDate = new Date(`${date}T00:00:00.000Z`);

  // Concurrency guard: never delete a snapshot that is still importing. Two imports racing on the
  // same date previously deleted each other's in-flight snapshot, causing FK violations on the
  // loan inserts. If an import for this date is already running, reject; otherwise replace.
  const existing = await prisma.snapshot.findUnique({ where: { reportDate } });
  if (existing?.status === 'IMPORTING') {
    return NextResponse.json(
      { error: 'Bu sana uchun import allaqachon ketyapti. Tugashini kuting yoki boshqa sana tanlang.' },
      { status: 409 },
    );
  }
  if (existing) {
    // Replace semantics: a finished (READY/FAILED) snapshot for this date is dropped (loans cascade).
    await prisma.snapshot.delete({ where: { id: existing.id } });
  }

  const snapshot = await prisma.snapshot.create({
    data: { reportDate, sourceFileName: file.name, status: 'IMPORTING' },
  });

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filePath = path.join(UPLOADS_DIR, `${snapshot.id}.xlsx`);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  const job = await prisma.job.create({
    data: { type: 'IMPORT', status: 'PENDING', snapshotId: snapshot.id },
  });

  // Fire-and-forget: the server process carries this to completion; the client polls the Job.
  // The `.catch` is a final backstop — runImportJob already records failures on the rows.
  void runImportJob(job.id, filePath, snapshot.id).catch(() => {});

  return NextResponse.json({ jobId: job.id, snapshotId: snapshot.id });
}
