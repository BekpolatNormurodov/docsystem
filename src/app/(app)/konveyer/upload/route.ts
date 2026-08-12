import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { dueForStage } from '@/lib/konveyer-sla';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';

const DIR = path.join(process.cwd(), 'exports', 'case-docs');
const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);

// GET ?caseId= — list a case's uploaded documents.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!caseId) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });
  const docs = await prisma.caseDocument.findMany({
    where: { caseId },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, kind: true, fileName: true, size: true, uploadedAt: true },
  });
  return NextResponse.json({ docs });
}

// POST multipart (caseId, kind, file) — store the file and record it.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const form = await req.formData();
  const caseId = Number(form.get('caseId'));
  const kind = String(form.get('kind') || 'BOSHQA');
  const file = form.get('file');
  if (!caseId || !(file instanceof File)) return NextResponse.json({ error: 'caseId va fayl kerak' }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Fayl 25MB dan katta' }, { status: 413 });

  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!ac) return NextResponse.json({ error: 'Case topilmadi' }, { status: 404 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const dir = path.join(DIR, String(caseId));
  await fs.mkdir(dir, { recursive: true });
  const fname = `${Date.now()}-${safe(file.name || 'hujjat')}`;
  const filePath = path.join(dir, fname);
  await fs.writeFile(filePath, bytes);

  const doc = await prisma.caseDocument.create({
    data: { caseId, kind, fileName: file.name || fname, filePath, size: bytes.length },
    select: { id: true, kind: true, fileName: true, size: true, uploadedAt: true },
  });

  // Smart auto-advance: uploading a signed/scanned ariza moves the case forward.
  const advanced = await autoAdvanceOnDoc(caseId, kind);
  return NextResponse.json({ doc, advanced });
}

// Which uploaded doc kind implies which minimum stage on the ariza track.
const KIND_STAGE: Record<string, string> = { SIGNED_ARIZA: 'SIGNED_SCANNED', CHAMBER: 'CHAMBER_RETURNED', ARIZA: 'ARIZA_GENERATED' };
const STAGE_ORDER = ['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];

async function autoAdvanceOnDoc(caseId: number, kind: string): Promise<string | null> {
  const target = KIND_STAGE[kind];
  if (!target) return null;
  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { stage: true, slaDays: true } });
  if (!ac) return null;
  if (STAGE_ORDER.indexOf(ac.stage) >= STAGE_ORDER.indexOf(target)) return null; // already past
  const now = new Date();
  // Working-day deadline (skips weekends), same as advanceStage — not calendar days.
  const due = await dueForStage(target as CaseStage, now);
  await prisma.arizaCase.update({ where: { id: caseId }, data: { stage: target as any, stageEnteredAt: now, dueAt: due } });
  return target;
}

// DELETE ?id= — remove an uploaded document (file + record).
export async function DELETE(req: NextRequest) {
  await requireAdmin();
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'id kerak' }, { status: 400 });
  const doc = await prisma.caseDocument.findUnique({ where: { id } });
  if (doc) {
    await fs.rm(doc.filePath, { force: true }).catch(() => {});
    await prisma.caseDocument.delete({ where: { id } });
  }
  return NextResponse.json({ ok: true });
}
