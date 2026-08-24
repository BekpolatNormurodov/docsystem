import type { Prisma } from '@prisma/client';

/**
 * Ro'yxat so'rovidagi filtrlarni bitta joyda yig'ish — jadval, statistika va Excel
 * eksporti AYNAN bir xil shartlardan foydalanishi uchun (ekrandagi ro'yxat bilan
 * yuklab olingan fayl bir-biriga mos tushsin).
 *
 * Alohida faylda, route ichida emas: Next.js route modulidan GET/POST'dan boshqa
 * narsani eksport qilib bo'lmaydi.
 */
export function buildInvoiceWhere(sp: URLSearchParams): Prisma.BillingCheckInvoiceWhereInput {
  const firmCode = sp.get('firm') || undefined;
  const status = sp.get('status') || undefined;
  // To'lov turi: «Почта харажатлари» / «Давлат божи» va h.k. (payCategory).
  const cat = sp.get('cat') || undefined;
  // Summa TIYINDA saqlanadi — mijoz ham tiyinda yuboradi (facet qiymatidan olingan).
  const amountRaw = sp.get('amount');
  const amount = amountRaw !== null && amountRaw !== '' && Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : undefined;
  const q = (sp.get('q') || '').trim();

  return {
    ...(firmCode ? { firmCode } : {}),
    ...(status ? { invoiceStatus: status } : {}),
    ...(cat ? { payCategory: cat } : {}),
    ...(amount !== undefined ? { amount } : {}),
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
}
