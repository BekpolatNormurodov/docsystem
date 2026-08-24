import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// GET ?firm=<code>&status=<CREATED|PAID|USED> — tarix (so'nggi qidiruvlar) + shu firma/holatga
// (yoki umuman) tegishli keshdagi kvitansiyalar + firma bo'yicha son taqsimoti.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const firmCode = req.nextUrl.searchParams.get('firm') || undefined;
  const status = req.nextUrl.searchParams.get('status') || undefined;
  const where = { ...(firmCode ? { firmCode } : {}), ...(status ? { invoiceStatus: status } : {}) };

  const [queries, invoices, summary] = await Promise.all([
    prisma.billingCheckQuery.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.billingCheckInvoice.findMany({ where, orderBy: { checkedAt: 'desc' }, take: 200 }),
    prisma.billingCheckInvoice.groupBy({ by: ['firmCode'], _count: { _all: true } }),
  ]);

  return NextResponse.json({ queries, invoices, summary });
}
