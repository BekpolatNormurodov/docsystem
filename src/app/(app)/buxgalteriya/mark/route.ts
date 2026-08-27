import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { dueForStage } from '@/lib/konveyer-sla';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// POST { caseId, paid } — buxgalter «To'landi»/«qaytarish» belgisi.
//   paid=true : INVOICE_CREATED → INVOICE_PAID (faqat kvitansiyasi bor case)
//   paid=false: INVOICE_PAID    → INVOICE_CREATED (qaytarish; keyingi bosqichga o'tgan bo'lsa — yo'q)
export async function POST(req: NextRequest) {
  await requireAccess('buxgalteriya');
  const body = await req.json().catch(() => ({}));
  const caseId = Number(body?.caseId);
  const paid = body?.paid === true;
  if (!caseId) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const target = paid ? 'INVOICE_PAID' : 'INVOICE_CREATED';
  const from = paid ? 'INVOICE_CREATED' : 'INVOICE_PAID';
  const now = new Date();
  const dueAt = await dueForStage(target, now);

  // Guard bilan: faqat kutilgan bosqichdan o'tkazamiz (oldinga ketgan case'ni orqaga tortmaymiz,
  // kvitansiyasiz case'ni to'landi qilmaymiz).
  const upd = await prisma.arizaCase.updateMany({
    where: { id: caseId, stage: from, ...(paid ? { receiptNumber: { not: null } } : {}) },
    data: { stage: target, stageEnteredAt: now, dueAt },
  });
  if (upd.count === 0) {
    return NextResponse.json({ error: 'Holatni o‘zgartirib bo‘lmadi (case allaqachon boshqa bosqichda)' }, { status: 409 });
  }
  await audit(AuditAction.STAGE_ADVANCE, { target: `case:${caseId}`, detail: { to: target, by: 'buxgalteriya' } });
  return NextResponse.json({ ok: true, paid });
}
