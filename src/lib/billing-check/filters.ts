import type { Prisma } from '@prisma/client';

/**
 * BIZ yaratadigan kvitansiyalarning standart summalari — TIYINDA (20 600 va 22 000 so'm).
 * Bulardan boshqa summadagi kvitansiya «ortiqcha»: odatda bekor qilinadi, shuning uchun
 * ularni ajratib ko'rsatish va filtrlash kerak.
 *
 * Summalar o'zgarsa shu yerni tahrirlash kifoya — jadval belgisi, filtr va Excel ustuni
 * hammasi shundan oziqlanadi.
 */
export const OWN_AMOUNTS_TIYIN = [2_060_000, 2_200_000];
export const isOwnAmount = (amount: unknown) =>
  amount !== null && amount !== undefined && OWN_AMOUNTS_TIYIN.includes(Number(amount));

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
  // own=1 → faqat bizning standart summalarimiz; own=0 → faqat «ortiqcha»lar.
  const own = sp.get('own');
  const q = (sp.get('q') || '').trim();

  return {
    ...(firmCode ? { firmCode } : {}),
    ...(status ? { invoiceStatus: status } : {}),
    ...(cat ? { payCategory: cat } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(own === '1' ? { amount: { in: OWN_AMOUNTS_TIYIN } } : {}),
    ...(own === '0' ? { amount: { notIn: OWN_AMOUNTS_TIYIN } } : {}),
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
