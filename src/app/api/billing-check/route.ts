import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { buildInvoiceWhere } from '@/lib/billing-check/filters';

export const runtime = 'nodejs';

// Keshdagi kvitansiyalar ro'yxati — firma/holat/tur/summa bo'yicha filtr, matn qidiruv,
// sahifalab. Bitta firmada 2000+ yozuv bo'lishi mumkin, hammasi birdan qaytarilmaydi.
// GET ?firm=&status=&cat=&amount=&q=&page=&size=
export async function GET(req: NextRequest) {
  await requireAdmin();
  const sp = req.nextUrl.searchParams;
  const page = Math.max(0, Number(sp.get('page')) || 0);
  const size = Math.min(200, Math.max(1, Number(sp.get('size')) || 20));
  const where = buildInvoiceWhere(sp);

  // Statistika holat bo'yicha bo'linadi, shuning uchun uning o'zi holat filtriga bog'lanmaydi —
  // qolgan filtrlar (firma/tur/summa/qidiruv) esa amal qiladi. Shunda «To'langan
  // (ishlatilmagan)» chipini bosganda ham yuqoridagi umumiy sonlar joyida turadi.
  const statsWhere: Prisma.BillingCheckInvoiceWhereInput = { ...where };
  delete (statsWhere as { invoiceStatus?: unknown }).invoiceStatus;

  // Tanlanadigan qiymatlar (facet) — faqat FIRMA kesimida. Tur/summa o'zaro cheklab
  // qo'ymasin: biror turni tanlagach summalar ro'yxati bo'shab qolmasligi kerak.
  const facetWhere: Prisma.BillingCheckInvoiceWhereInput = sp.get('firm') ? { firmCode: sp.get('firm')! } : {};

  const [invoices, total, summary, stats, catFacet, amountFacet] = await Promise.all([
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
    prisma.billingCheckInvoice.groupBy({ by: ['payCategory'], where: facetWhere, _count: { _all: true } }),
    prisma.billingCheckInvoice.groupBy({ by: ['amount'], where: facetWhere, _count: { _all: true } }),
  ]);

  return NextResponse.json({ invoices, total, page, size, summary, stats, catFacet, amountFacet });
}
