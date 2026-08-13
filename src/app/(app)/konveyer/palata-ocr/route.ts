import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runPalataOcrJob, reapStaleOcrJobs } from '@/lib/palata-ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Palata scan → OCR: upload the signed scanned arizas here; the server OCRs each page
// (Windows engine), extracts firma + PINFL + name/address, and merges into the palata
// dataset. Heavy OCR runs as a background Job so the request returns immediately.
const TMP = path.join(process.cwd(), 'exports', 'palata-ocr-tmp');
const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);
const MAX = 200 * 1024 * 1024; // 200MB — a long chamber scan can be >100MB

// GET → the latest OCR job's status (for progress polling).
export async function GET() {
  await requireUser();
  await reapStaleOcrJobs();
  const job = await prisma.job.findFirst({ where: { type: 'PALATA_OCR' }, orderBy: { id: 'desc' } });
  if (!job) return NextResponse.json({ job: null });
  return NextResponse.json({ job: { id: job.id, status: job.status, progress: job.progress, total: job.total, message: job.message } });
}

// POST multipart (files) → save temps, start a background OCR job, return its id.
export async function POST(req: NextRequest) {
  await requireUser();
  // Refuse to pile a second OCR run on top of a LIVE one (stale/dead jobs reaped first).
  await reapStaleOcrJobs();
  const running = await prisma.job.findFirst({ where: { type: 'PALATA_OCR', status: { in: ['PENDING', 'RUNNING'] } } });
  if (running) return NextResponse.json({ error: 'OCR allaqachon ishlayapti, kuting.' }, { status: 409 });

  const form = await req.formData();
  // «Mavjudlarni yangilash» — a re-scan of an already-saved client overwrites its
  // stored PDF instead of being skipped. Default off (never silently overwrite).
  const update = String(form.get('update') || '') === 'true';
  const items = [...form.getAll('files'), ...form.getAll('file')].filter((x): x is File => x instanceof File);
  if (items.length === 0) return NextResponse.json({ error: 'Fayl kerak' }, { status: 400 });
  if (items.some((f) => f.size > MAX)) return NextResponse.json({ error: 'Fayl 200MB dan katta' }, { status: 413 });
  if (items.some((f) => !/\.pdf$/i.test(f.name || ''))) return NextResponse.json({ error: 'Faqat PDF' }, { status: 415 });

  await fs.mkdir(TMP, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const buf = Buffer.from(await items[i].arrayBuffer());
    const p = path.join(TMP, `${Date.now()}-${i}-${safe(items[i].name || 'skan.pdf')}`);
    await fs.writeFile(p, buf);
    paths.push(p);
  }

  const job = await prisma.job.create({ data: { type: 'PALATA_OCR', status: 'PENDING', total: 0, progress: 0 } });
  // Fire-and-forget — progress lives on the Job row (polled via GET). A dev-server
  // restart mid-run leaves the job RUNNING; the user can simply re-upload.
  void runPalataOcrJob(job.id, paths, update);
  return NextResponse.json({ jobId: job.id, files: paths.length });
}
