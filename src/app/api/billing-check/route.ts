import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

// Keshdagi kvitansiyalar ro'yxati — firma/holat bo'yicha filtr, matn qidiruv, sahifalab.
// Bitta firmada 2000+ yozuv bo'lishi mumkin, shuning uchun hammasi birdan qaytarilmaydi.
// GET ?firm=<code>&status=<CREATED|PAID|USED>&q=<matn>&page=<0..>&size=<1..200>
export async function GET(req: NextRequest) {
  await requireAdmin();
  const sp = req.nextUrl.searchParams;
  const firmCode = sp.get('firm') || undefined;
  const status = sp.get('status') || undefined;
  const q = (sp.get('q') || '').trim();
  const page = Math.max(0, Number(sp.get('page')) || 0);
  const size = Math.min(200, Math.max(1, Number(sp.get('size')) || 20));

  const where: Prisma.BillingCheckInvoiceWhereInput = {
    ...(firmCode ? { firmCode } : {}),
    ...(status ? { invoiceStatus: status } : {}),
    // Qidiruv: kvitansiya raqami, egasi (firma nomi), STIR yoki da'vo raqami bo'yicha.
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
  };

  // Statistika holat bo'yicha bo'linadi, shuning uchun uning o'zi holat filtriga bog'lanmaydi —
  // faqat firma va qidiruvga. Shunda «To'langan (ishlatilmagan)» chipini bosganda ham
  // yuqoridagi umumiy sonlar joyida turadi.
  const statsWhere: Prisma.BillingCheckInvoiceWhereInput = { ...where };
  delete (statsWhere as { invoiceStatus?: unknown }).invoiceStatus;

  const [invoices, total, summary, stats] = await Promise.all([
    prisma.billingCheckInvoice.findMany({
      where,
      // Yangi kvitansiyalar tepada. issuedAt faqat ro'yxatdan kelganda to'ladi (bitta raqam
      // bo'yicha checkStatus uni qaytarmaydi) — shunday yozuvlar uchun checkedAt zaxira tartib.
      orderBy: [{ issuedAt: 'desc' }, { checkedAt: 'desc' }],
      skip: page * size,
      take: size,
    }),
    prisma.billingCheckInvoice.count({ where }),
    // Chip'lardagi sonlar — qidiruv/holat filtridan MUSTAQIL, faqat firma kesimida.
    prisma.billingCheckInvoice.groupBy({ by: ['firmCode'], _count: { _all: true } }),
    prisma.billingCheckInvoice.groupBy({
      by: ['invoiceStatus'],
      where: statsWhere,
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  return NextResponse.json({ invoices, total, page, size, summary, stats });
}
