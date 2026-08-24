import { prisma } from '@/lib/db';
import { firmByStir } from '@/lib/firms';

export type CheckSource = 'SINGLE' | 'LIST';

export interface UpsertRow {
  number: string;
  invoiceStatus: string;
  amount?: number | null;
  paidAmount?: number | null;
  mustPayAmount?: number | null;
  balance?: number | null;
  payer?: string | null;
  payerTin?: string | null;
  court?: string | null;
  courtId?: number | null;
  forAccount?: string | null;
  description?: string | null;
  payCategory?: string | null;
  claimCaseNumber?: string | null;
  issuedAt?: Date | null;
  expiresAt?: Date | null;
  source: CheckSource;
  raw?: unknown;
}

// Kesh: kvitansiya raqami bo'yicha upsert. Har ikki qidiruv rejimi (bitta raqam / STIR
// ro'yxati) shu bitta jadvalga tushadi — tarix va «bu firma bo'yicha nechta bor» hisobi shu
// yerdan olinadi.
//
// DIQQAT: ikki manba TENG EMAS. Ro'yxat (captcha/search) to'liq yozuvni qaytaradi, bitta
// kvitansiya (checkStatus) esa `balance`, `issuedAt`, `expiresAt` ni UMUMAN qaytarmaydi.
// Shuning uchun update'ga har doim `?? null` yozib bo'lmaydi: aks holda 2000 ta yozuv
// yig'ilgandan keyin bitta kvitansiyani qayta tekshirish o'sha qatorning sanalarini
// o'chirib yuborardi (va u ro'yxat oxiriga tushib qolardi). Yechim: chaqiruvchi
// UZATMAGAN maydon `undefined` bo'lib qoladi — Prisma update'da bunday ustunga tegmaydi,
// create'da esa uni tashlab ketadi (nullable ustun NULL bo'ladi).
export async function upsertCheckedInvoice(row: UpsertRow) {
  const pick = <K extends keyof UpsertRow>(k: K) => (k in row ? ((row[k] ?? null) as never) : undefined);

  const data = {
    invoiceStatus: row.invoiceStatus,
    amount: pick('amount'),
    paidAmount: pick('paidAmount'),
    mustPayAmount: pick('mustPayAmount'),
    balance: pick('balance'),
    payer: pick('payer'),
    payerTin: pick('payerTin'),
    // Firma kodi payerTin'dan kelib chiqadi — demak faqat payerTin uzatilganda qayta hisoblanadi.
    firmCode: 'payerTin' in row ? (row.payerTin ? firmByStir(row.payerTin)?.branchCode ?? null : null) : undefined,
    court: pick('court'),
    courtId: pick('courtId'),
    forAccount: pick('forAccount'),
    description: pick('description'),
    payCategory: pick('payCategory'),
    claimCaseNumber: pick('claimCaseNumber'),
    issuedAt: pick('issuedAt'),
    expiresAt: pick('expiresAt'),
    source: row.source,
    raw: (row.raw ?? undefined) as never,
    checkedAt: new Date(),
  };

  return prisma.billingCheckInvoice.upsert({
    where: { number: row.number },
    create: { number: row.number, ...data },
    update: data,
  });
}
