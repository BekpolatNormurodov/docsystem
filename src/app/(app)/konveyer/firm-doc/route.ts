import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { FirmDocKind } from '@prisma/client';

export const runtime = 'nodejs';

const DIR = path.join(process.cwd(), 'exports', 'firm-docs');
const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);
const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

// GET ?firmId= → the firm's library docs; GET ?download=<id> → stream a file.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const dl = req.nextUrl.searchParams.get('download');
  if (dl) {
    const dlId = Number(dl);
    if (!Number.isInteger(dlId) || dlId <= 0) return NextResponse.json({ error: 'download id notoʻgʻri' }, { status: 400 });
    const doc = await prisma.firmDocument.findUnique({ where: { id: dlId } });
    if (!doc) return NextResponse.json({ error: 'Topilmadi' }, { status: 404 });
    let buf: Buffer;
    try { buf = await fs.readFile(doc.filePath); } catch { return NextResponse.json({ error: 'Fayl yo‘q' }, { status: 404 }); }
    const ext = path.extname(doc.filePath).toLowerCase();
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.label || doc.kind)}${ext}"` },
    });
  }
  const firmId = Number(req.nextUrl.searchParams.get('firmId'));
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });
  const docs = await prisma.firmDocument.findMany({ where: { firmId }, select: { id: true, kind: true, label: true } });
  return NextResponse.json({ docs });
}

// POST multipart (firmId, kind, file) — upsert a firm-library doc (one per kind).
export async function POST(req: NextRequest) {
  await requireAdmin();
  const form = await req.formData();
  const firmId = Number(form.get('firmId'));
  const kind = String(form.get('kind') || 'BOSHQA') as FirmDocKind;
  const file = form.get('file');
  if (!firmId || !(file instanceof File)) return NextResponse.json({ error: 'firmId va fayl kerak' }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Fayl 25MB dan katta' }, { status: 413 });
  // Whitelist the enum so an unexpected kind can't 500 on prisma.create.
  const ALLOWED: FirmDocKind[] = ['GUVOHNOMA', 'ISHONCHNOMA', 'SHARTNOMA', 'OFERTA', 'BOSHQA'];
  if (!ALLOWED.includes(kind)) return NextResponse.json({ error: 'kind notoʻgʻri' }, { status: 400 });

  const dir = path.join(DIR, String(firmId));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${kind}-${Date.now()}-${safe(file.name || 'hujjat')}`);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  // One doc per (firm, kind): drop older ones.
  const old = await prisma.firmDocument.findMany({ where: { firmId, kind } });
  await Promise.all(old.map((d) => fs.rm(d.filePath, { force: true }).catch(() => {})));
  await prisma.firmDocument.deleteMany({ where: { firmId, kind } });

  const doc = await prisma.firmDocument.create({ data: { firmId, kind, label: file.name || kind, filePath }, select: { id: true, kind: true, label: true } });
  return NextResponse.json({ doc });
}

export async function DELETE(req: NextRequest) {
  await requireAdmin();
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'id kerak' }, { status: 400 });
  const doc = await prisma.firmDocument.findUnique({ where: { id } });
  if (doc) { await fs.rm(doc.filePath, { force: true }).catch(() => {}); await prisma.firmDocument.delete({ where: { id } }); }
  return NextResponse.json({ ok: true });
}
