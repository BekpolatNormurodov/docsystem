import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildInvoiceDocx } from '@/lib/invoice-docx';

export const runtime = 'nodejs';

// GET ?caseId= — the case's boji invoice (kvitansiya) as a .docx, generated from
// the assigned receipt number. Auto-generated (created when the buxgalter batch
// assigns the receipt) — no manual upload.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!caseId) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: { clientName: true, kod: true, receiptNumber: true, stageEnteredAt: true, batch: { select: { createdAt: true } }, firm: { select: { shortName: true, legalName: true, stir: true, bankAccount: true, mfo: true } } },
  });
  if (!ac) return NextResponse.json({ error: 'Case topilmadi' }, { status: 404 });
  if (!ac.receiptNumber) return NextResponse.json({ error: 'Invoice hali yaratilmagan (buxgalteriya bosqichida yaratiladi)' }, { status: 409 });

  let buffer: Buffer;
  try {
    buffer = await buildInvoiceDocx({ clientName: ac.clientName, kod: ac.kod, receiptNumber: ac.receiptNumber, assignedAt: ac.batch?.createdAt ?? ac.stageEnteredAt, firm: ac.firm });
  } catch (e) {
    console.error('gen-invoice failed', e);
    return NextResponse.json({ error: 'Invoice yaratilmadi' }, { status: 500 });
  }

  const safe = (ac.clientName || `case-${caseId}`).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Invoice_${ac.receiptNumber}_${safe}.docx`)}"`,
    },
  });
}
