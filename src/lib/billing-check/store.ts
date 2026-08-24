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
export async function upsertCheckedInvoice(row: UpsertRow) {
  const firmCode = row.payerTin ? firmByStir(row.payerTin)?.branchCode ?? null : null;
  const data = {
    invoiceStatus: row.invoiceStatus,
    amount: row.amount ?? null,
    paidAmount: row.paidAmount ?? null,
    mustPayAmount: row.mustPayAmount ?? null,
    balance: row.balance ?? null,
    payer: row.payer ?? null,
    payerTin: row.payerTin ?? null,
    firmCode,
    court: row.court ?? null,
    courtId: row.courtId ?? null,
    forAccount: row.forAccount ?? null,
    description: row.description ?? null,
    payCategory: row.payCategory ?? null,
    claimCaseNumber: row.claimCaseNumber ?? null,
    issuedAt: row.issuedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    source: row.source,
    raw: (row.raw ?? undefined) as any,
    checkedAt: new Date(),
  };
  return prisma.billingCheckInvoice.upsert({
    where: { number: row.number },
    create: { number: row.number, ...data },
    update: data,
  });
}
