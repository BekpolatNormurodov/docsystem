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

  // Replace semantics: reimporting the same date drops the previous snapshot (loans cascade).
  await prisma.snapshot.deleteMany({ where: { reportDate } });

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
  void runImportJob(job.id, filePath, snapshot.id);

  return NextResponse.json({ jobId: job.id, snapshotId: snapshot.id });
}
