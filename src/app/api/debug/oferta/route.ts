// DEBUG-only: render a single loan's oferta to PDF for visual QA. GET ?loanId=NNN
// (optional &ins=PCT for the таъминот %). Behind the normal auth middleware. Not linked
// from any UI — a throwaway endpoint for iterating on the oferta template.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { renderOfertaPdf, ofertaFields } from '@/lib/oferta-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const loanId = Number(req.nextUrl.searchParams.get('loanId'));
  const ins = Number(req.nextUrl.searchParams.get('ins')) || 0;
  if (!Number.isFinite(loanId) || loanId <= 0) return NextResponse.json({ error: 'loanId required' }, { status: 400 });
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) return NextResponse.json({ error: 'loan not found' }, { status: 404 });
  const firm = loan.branchCode ? await prisma.firm.findUnique({ where: { code: loan.branchCode } }) : null;

  // ?fields=1 → return the computed {{token}} map as JSON (no chromium) for value QA.
  if (req.nextUrl.searchParams.get('fields') === '1') {
    return NextResponse.json(ofertaFields(loan as never, firm ?? {}, loan.clientName, loan.pinfl, ins));
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const buf = await renderOfertaPdf(loan as never, firm ?? {}, browser, loan.clientName, loan.pinfl, ins);
    return new NextResponse(buf as never, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="oferta-${loanId}.pdf"` },
    });
  } finally {
    await browser.close().catch(() => {});
  }
}
