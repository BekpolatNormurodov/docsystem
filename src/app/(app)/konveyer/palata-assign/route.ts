import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { dueForStage } from '@/lib/konveyer-sla';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

const INBOX = path.join(process.cwd(), 'exports', 'palata-inbox');
const DOCS = path.join(process.cwd(), 'exports', 'case-docs');
const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);
const STAGE_ORDER = ['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];

// POST { file, caseId } — assign an inbox scan to a case as its signed ariza,
// then auto-advance the case to SIGNED_SCANNED. Removes the file from the inbox.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const file = String(body?.file || '');
  const caseId = Number(body?.caseId);
  if (!file || !caseId) return NextResponse.json({ error: 'file va caseId kerak' }, { status: 400 });

  const src = path.join(INBOX, path.basename(file));
  let buf: Buffer;
  try { buf = await fs.readFile(src); } catch { return NextResponse.json({ error: 'Skan topilmadi' }, { status: 404 }); }

  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { stage: true, slaDays: true } });
  if (!ac) return NextResponse.json({ error: 'Case topilmadi' }, { status: 404 });

  const dir = path.join(DOCS, String(caseId));
  await fs.mkdir(dir, { recursive: true });
  // Sanitize from the BASENAME so a crafted `file` can't escape the case dir.
  const cleanName = safe(path.basename(file).replace(/^\d+-\d+-/, '')) || 'imzolangan-ariza.pdf';
  const dest = path.join(dir, `${Date.now()}-${cleanName}`);
  await fs.writeFile(dest, buf);

  await prisma.caseDocument.create({ data: { caseId, kind: 'SIGNED_ARIZA', fileName: cleanName, filePath: dest, size: buf.length } });
  await fs.rm(src, { force: true }).catch(() => {});

  // Auto-advance to SIGNED_SCANNED if not already past.
  let advanced: string | null = null;
  if (STAGE_ORDER.indexOf(ac.stage) < STAGE_ORDER.indexOf('SIGNED_SCANNED')) {
    const now = new Date();
    // Working-day deadline (skips weekends), consistent with advanceStage.
    await prisma.arizaCase.update({ where: { id: caseId }, data: { stage: 'SIGNED_SCANNED', stageEnteredAt: now, dueAt: await dueForStage('SIGNED_SCANNED', now) } });
    advanced = 'SIGNED_SCANNED';
  }
  await audit(AuditAction.PALATA_SCAN, { target: `case:${caseId}`, detail: { advanced } });
  return NextResponse.json({ ok: true, advanced });
}
