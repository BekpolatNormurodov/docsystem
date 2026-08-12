import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildTalabnomaRows, type TalabnomaLoan } from '@/lib/hippo/talabnoma-excel';
import { renderTalabnomaPdf } from '@/lib/hippo/talabnoma-pdf';

export const runtime = 'nodejs';

// GET ?caseId= — generate this client's talabnoma PDF on the fly from the
// portfolio loan data and stream it as a download.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: { pinfl: true, snapshotId: true, kod: true, clientName: true },
  });
  if (!ac?.pinfl || !ac.snapshotId) return NextResponse.json({ error: 'Case yoki mijoz maʼlumoti yoʻq' }, { status: 404 });

  // Letterhead firm (was hardcoded in the template → wrong firm on every PDF).
  const firm = ac.kod ? await prisma.firm.findUnique({ where: { code: ac.kod }, select: { legalName: true, shortName: true, address: true, stir: true, bankAccount: true, mfo: true, phone: true } }) : null;

  const loans = (await prisma.loan.findMany({
    where: { snapshotId: ac.snapshotId, pinfl: ac.pinfl, ...(ac.kod ? { branchCode: ac.kod } : {}) },
    orderBy: { id: 'asc' },
    select: { pinfl: true, branchCode: true, clientName: true, postAddress: true, postAddressUz: true, regionName: true, ldId: true, dateToCr: true, summKr: true, totalDebt: true, raw: true },
  })) as TalabnomaLoan[];
  if (loans.length === 0) return NextResponse.json({ error: 'Portfel maʼlumoti topilmadi' }, { status: 404 });

  // Debt gate — no outstanding debt → nothing to demand, so no talabnoma (mirrors the
  // ariza's own «Qarzdorlik 0» refusal so the two documents are never inconsistent).
  const caseDebt = loans.reduce((s, l) => s + (Number((l as { totalDebt?: unknown }).totalDebt) || 0), 0);
  if (caseDebt <= 0) return NextResponse.json({ error: 'Qarzdorlik 0 — talabnoma yaratilmaydi' }, { status: 422 });

  // Use the snapshot's reportDate (same as the one-click packet) so the doc date
  // and contract_id are stable no matter which button generated it.
  const snapshot = await prisma.snapshot.findUnique({ where: { id: ac.snapshotId }, select: { reportDate: true } });
  const rows = buildTalabnomaRows(loans, snapshot?.reportDate ?? new Date());
  if (rows.length === 0) return NextResponse.json({ error: 'Talabnoma qatori shakllanmadi' }, { status: 400 });

  let buf: Buffer;
  let browser: Awaited<ReturnType<Awaited<typeof import('playwright')>['chromium']['launch']>> | null = null;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    buf = await renderTalabnomaPdf(rows[0], browser, firm);
  } catch (e) {
    console.error('gen-talabnoma failed', e);
    return NextResponse.json({ error: 'Talabnoma yaratilmadi' }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // Smart auto-mark: generating the talabnoma flags the parallel track as sent.
  await prisma.arizaCase.updateMany({ where: { id: caseId, talabnomaAt: null }, data: { talabnomaAt: new Date() } });

  const safe = (ac.clientName || `case-${caseId}`).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Talabnoma_${safe}.pdf`)}"`,
    },
  });
}
