import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildGrafikDocx, isSchedulableLoan, type GrafikLoan } from '@/lib/grafik-docx';

export const runtime = 'nodejs';

// GET ?caseId= — the client's kredit toʻlash grafigi (.docx), a computed annuity
// (equal monthly payment) schedule per contract. Auto-generated — no manual upload.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: { pinfl: true, snapshotId: true, kod: true, clientName: true },
  });
  if (!ac?.pinfl || !ac.snapshotId) return NextResponse.json({ error: 'Case maʼlumoti yoʻq' }, { status: 404 });

  const firm = ac.kod ? await prisma.firm.findUnique({ where: { code: ac.kod }, select: { shortName: true } }) : null;
  const loans = (await prisma.loan.findMany({
    where: { snapshotId: ac.snapshotId, pinfl: ac.pinfl, ...(ac.kod ? { branchCode: ac.kod } : {}) },
    orderBy: { id: 'asc' },
    select: { ldId: true, summKr: true, rate: true, dateToCr: true, dateClose: true },
  })) as GrafikLoan[];
  // Only loans that can actually produce a schedule (positive amount + both dates in
  // chronological order) — else the grafik would be a header-only or reversed-date doc.
  const usable = loans.filter(isSchedulableLoan);
  if (usable.length === 0) return NextResponse.json({ error: 'Grafik uchun maʼlumot yetarli emas (summa/muddat yoʻq)' }, { status: 404 });

  let buf: Buffer;
  try {
    buf = await buildGrafikDocx(usable, ac.clientName, firm?.shortName || ac.kod || '');
  } catch (e) {
    console.error('gen-grafik failed', e);
    return NextResponse.json({ error: 'Grafik yaratilmadi' }, { status: 500 });
  }

  const safe = (ac.clientName || `case-${caseId}`).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Grafik_${safe}.docx`)}"`,
    },
  });
}
