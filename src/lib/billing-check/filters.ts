import type { Prisma } from '@prisma/client';

/**
 * «Bizning summalarimiz» — biz yaratadigan kvitansiyalarning summalari (TIYINDA:
 * 2 060 000 = 20 600 so'm). Boshqasi «ortiqcha»: summa xato kiritilgan yoki sud
 * qo'shimcha qo'ygan, odatda bekor qilinadi. Ro'yxatning o'zi sozlamada saqlanadi
 * (config.ts) — bu yerda faqat default va sof tekshiruv.
 *
 * DIQQAT: bu fayl klient komponentida ham import qilinadi, shuning uchun u YERDA
 * prisma yoki boshqa server-only narsa bo'lmasligi kerak (config.ts prisma'ni
 * import qiladi va faqat serverda ishlatiladi).
 */
export const DEFAULT_OWN_AMOUNTS_TIYIN = [2_060_000, 2_200_000];
export const isOwn = (amount: unknown, own: number[]) =>
  amount !== null && amount !== undefined && own.includes(Number(amount));

/**
 * Ro'yxat so'rovidagi filtrlarni bitta joyda yig'ish — jadval, statistika va Excel
 * eksporti AYNAN bir xil shartlardan foydalanishi uchun (ekrandagi ro'yxat bilan
 * yuklab olingan fayl bir-biriga mos tushsin).
 *
 * Alohida faylda, route ichida emas: Next.js route modulidan GET/POST'dan boshqa
 * narsani eksport qilib bo'lmaydi.
 *
 * `ownAmounts` — «bizning summalarimiz» ro'yxati (tiyinda), sozlamadan keladi
 * (src/lib/billing-check/config.ts). own=1/0 filtri shunga tayanadi.
 */
export function buildInvoiceWhere(sp: URLSearchParams, ownAmounts: number[] = []): Prisma.BillingCheckInvoiceWhereInput {
  const firmCode = sp.get('firm') || undefined;
  const status = sp.get('status') || undefined;
  // To'lov turi: «Почта харажатлари» / «Давлат божи» va h.k. (payCategory).
  const cat = sp.get('cat') || undefined;
  // Summa TIYINDA saqlanadi — mijoz ham tiyinda yuboradi (facet qiymatidan olingan).
  const amountRaw = sp.get('amount');
  const amount = amountRaw !== null && amountRaw !== '' && Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : undefined;
  // own=1 → faqat bizning standart summalarimiz; own=0 → faqat «ortiqcha»lar.
  const own = sp.get('own');
  const q = (sp.get('q') || '').trim();
  // Yaratilgan sana oralig'i (YYYY-MM-DD). `to` — shu kunning OXIRIGACHA.
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const issuedAt: Prisma.DateTimeNullableFilter | undefined =
    from || to
      ? {
          ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
          ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
        }
      : undefined;

  return {
    ...(firmCode ? { firmCode } : {}),
    ...(status ? { invoiceStatus: status } : {}),
    ...(cat ? { payCategory: cat } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(own === '1' ? { amount: { in: ownAmounts } } : {}),
    ...(own === '0' ? { amount: { notIn: ownAmounts } } : {}),
    ...(issuedAt ? { issuedAt } : {}),
    // Matn qidiruvi — yozuvning ko'zga ko'rinadigan hamma maydoni bo'yicha, shunda
    // «nimani qidirsam bo'ladi» degan savol tug'ilmaydi.
    ...(q
      ? {
          OR: [
            { number: { contains: q } },
            { payer: { contains: q } },
            { payerTin: { contains: q } },
            { claimCaseNumber: { contains: q } },
            { court: { contains: q } },
            { description: { contains: q } },
            { payCategory: { contains: q } },
            { forAccount: { contains: q } },
          ],
        }
      : {}),
  };
}
