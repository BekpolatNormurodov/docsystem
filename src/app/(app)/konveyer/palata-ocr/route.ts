import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { drainOcrQueue, reapStaleOcrJobs, QUEUE_DIR } from '@/lib/palata-ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Palata scan → OCR: upload the signed scanned arizas here; the server OCRs each page,
// extracts firma + PINFL + name/address, and merges into the palata dataset. Heavy OCR
// runs as a background Job so the request returns immediately. Uploads are QUEUED — a new
// upload while one is running is appended and drained by the same job (no waiting).
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

// DELETE → «Bekor qilish»: set the live OCR job out of RUNNING/PENDING. The background
// loop checks status between chunks and stops within ~one chunk; the current chunk's
// tesseract processes finish, then the loop breaks. Idempotent (no live job → 200 ok).
export async function DELETE() {
  await requireUser();
  const { count } = await prisma.job.updateMany({
    where: { type: 'PALATA_OCR', status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'FAILED', message: 'Bekor qilinmoqda…' },
  });
  return NextResponse.json({ cancelled: count });
}

// POST multipart (files) → append to the OCR queue; start a drainer if none is running,
// else the live drainer picks them up. Uploading again mid-run just enqueues (no 409).
export async function POST(req: NextRequest) {
  await requireUser();
  await reapStaleOcrJobs();

  const form = await req.formData();
  // «Mavjudlarni yangilash» — a re-scan of an already-saved client overwrites its
  // stored PDF instead of being skipped. Default off (never silently overwrite).
  const update = String(form.get('update') || '') === 'true';
  const items = [...form.getAll('files'), ...form.getAll('file')].filter((x): x is File => x instanceof File);
  if (items.length === 0) return NextResponse.json({ error: 'Fayl kerak' }, { status: 400 });
  if (items.some((f) => f.size > MAX)) return NextResponse.json({ error: 'Fayl 200MB dan katta' }, { status: 413 });
  if (items.some((f) => !/\.pdf$/i.test(f.name || ''))) return NextResponse.json({ error: 'Faqat PDF' }, { status: 415 });

  await fs.mkdir(QUEUE_DIR, { recursive: true });
  for (let i = 0; i < items.length; i++) {
    const buf = Buffer.from(await items[i].arrayBuffer());
    // Nom prefiksi = vaqt tamg'asi → drainer nom bo'yicha tartibda (yuklash tartibida) yutadi.
    const p = path.join(QUEUE_DIR, `${Date.now()}-${String(i).padStart(3, '0')}-${safe(items[i].name || 'skan.pdf')}`);
    await fs.writeFile(p, buf);
  }

  // Ish allaqachon ketayotgan bo'lsa — shu drainer navbatdagi yangi fayllarni ham oladi.
  const running = await prisma.job.findFirst({ where: { type: 'PALATA_OCR', status: { in: ['PENDING', 'RUNNING'] } } });
  if (running) return NextResponse.json({ jobId: running.id, files: items.length, queued: true });

  const job = await prisma.job.create({ data: { type: 'PALATA_OCR', status: 'PENDING', total: 0, progress: 0 } });
  void drainOcrQueue(job.id, update);
  return NextResponse.json({ jobId: job.id, files: items.length });
}
