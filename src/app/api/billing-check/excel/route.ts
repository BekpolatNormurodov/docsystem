import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildBillingCheckExcel } from '@/lib/billing-check/excel';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET ?firm=<code>&status=<CREATED|PAID|USED>&q=<matn> — keshdagi kvitansiyalarni xlsx qilib
// beradi. Filtrlar UI dagi bilan bir xil: yuklab olingan fayl ekranda ko'rinayotgan ro'yxatga mos.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const firmCode = req.nextUrl.searchParams.get('firm') || undefined;
  const status = req.nextUrl.searchParams.get('status') || undefined;
  const q = (req.nextUrl.searchParams.get('q') || '').trim();

  const rows = await prisma.billingCheckInvoice.findMany({
    where: {
      ...(firmCode ? { firmCode } : {}),
      ...(status ? { invoiceStatus: status } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q } },
              { payer: { contains: q } },
              { payerTin: { contains: q } },
              { claimCaseNumber: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { issuedAt: 'desc' },
  });
  const buf = await buildBillingCheckExcel(rows);
  const name = `kvitansiyalar${firmCode ? `-${firmCode}` : ''}${status ? `-${status}` : ''}.xlsx`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
      'Content-Length': String(buf.length),
    },
  });
}
