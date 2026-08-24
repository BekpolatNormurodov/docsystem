import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildBillingCheckExcel } from '@/lib/billing-check/excel';
import { buildInvoiceWhere } from '@/lib/billing-check/filters';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET ?firm=&status=&cat=&amount=&q= — keshdagi kvitansiyalarni xlsx qilib beradi.
// Filtrlar ro'yxat so'rovi bilan BIR XIL manbadan (buildInvoiceWhere) olinadi, shuning
// uchun yuklangan fayl ekranda ko'rinayotgan ro'yxatga aynan mos tushadi.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const sp = req.nextUrl.searchParams;
  const rows = await prisma.billingCheckInvoice.findMany({
    where: buildInvoiceWhere(sp),
    orderBy: [{ issuedAt: 'desc' }, { checkedAt: 'desc' }],
  });

  const buf = await buildBillingCheckExcel(rows);
  const parts = ['kvitansiyalar', sp.get('firm'), sp.get('status')].filter(Boolean);
  const name = `${parts.join('-')}.xlsx`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
      'Content-Length': String(buf.length),
    },
  });
}
