import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildTalabnomaRows, talabnomaExcelBuffer, type TalabnomaLoan } from '@/lib/hippo/talabnoma-excel';

export const runtime = 'nodejs';

// GET ?caseId= — the client's talabnoma as an .xlsx (hippo import layout),
// generated on the fly from the portfolio. Separate document from the PDF.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!caseId) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: { pinfl: true, snapshotId: true, kod: true, clientName: true },
  });
  if (!ac?.pinfl || !ac.snapshotId) return NextResponse.json({ error: 'Case maʼlumoti yoʻq' }, { status: 404 });

  const loans = (await prisma.loan.findMany({
    where: { snapshotId: ac.snapshotId, pinfl: ac.pinfl, ...(ac.kod ? { branchCode: ac.kod } : {}) },
    orderBy: { id: 'asc' },
    select: { pinfl: true, branchCode: true, clientName: true, postAddress: true, postAddressUz: true, regionName: true, ldId: true, dateToCr: true, summKr: true, totalDebt: true, raw: true },
  })) as TalabnomaLoan[];
  if (loans.length === 0) return NextResponse.json({ error: 'Portfel maʼlumoti topilmadi' }, { status: 404 });

  // Use the snapshot's reportDate (same as the one-click packet) so the doc date
  // and contract_id are stable no matter which button generated it.
  const snapshot = await prisma.snapshot.findUnique({ where: { id: ac.snapshotId }, select: { reportDate: true } });
  const rows = buildTalabnomaRows(loans, snapshot?.reportDate ?? new Date());
  if (rows.length === 0) return NextResponse.json({ error: 'Talabnoma qatori shakllanmadi' }, { status: 400 });

  let buf: Buffer;
  try {
    buf = await talabnomaExcelBuffer(rows);
  } catch (e) {
    console.error('gen-talabnoma-excel failed', e);
    return NextResponse.json({ error: 'Excel yaratilmadi' }, { status: 500 });
  }

  // Flag the parallel talabnoma track as prepared (same as the PDF path).
  await prisma.arizaCase.updateMany({ where: { id: caseId, talabnomaAt: null }, data: { talabnomaAt: new Date() } });

  const safe = (ac.clientName || `case-${caseId}`).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Talabnoma_${safe}.xlsx`)}"`,
    },
  });
}
