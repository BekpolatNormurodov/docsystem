// Buxgalteriya moduli: Mohigul yaratgan boji invoice'lari (receiptNumber olgan case'lar) firmalar
// bo'yicha ro'yxati + holati. Buxgalter (Ulugbek) har mijozni «To'landi» deb belgilaydi
// (stage INVOICE_CREATED → INVOICE_PAID). Sana (snapshot) filtri butun ilovadagidek.
import { prisma } from './db';
import type { CaseStage } from '@prisma/client';
import { getBojiAmount } from './konveyer-buxgalter';

// «To'langan» — INVOICE_PAID va undan keyingi bosqichlar (sud/MIB'ga o'tsa ham to'langan bo'lib qoladi).
const PAID_STAGES: CaseStage[] = ['INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];

export interface BxRow {
  caseId: number;
  clientName: string | null;
  kod: string | null;
  receiptNumber: string | null; // noyob kvitansiya raqami (shot id)
  invoiceNo: string | null;
  amount: number; // shu invoice'ning HAQIQIY summasi (narx o'zgaruvchi)
  paid: boolean;
  locked: boolean; // bosqich INVOICE_PAID'dan o'tib ketgan — belgilashni qaytarib bo'lmaydi
}
export interface BxFirm {
  firmId: number;
  firmName: string;
  rows: BxRow[];
  total: number;
  paid: number;
  unpaid: number;
  sum: number;
  paidSum: number;
  unpaidSum: number;
}
export interface BxData {
  amount: number; // fallback boji summasi (invoice summasi topilmasa)
  firms: BxFirm[];
  total: number;
  paidCount: number;
  unpaidCount: number;
  sum: number;
  paidSum: number;
  unpaidSum: number;
}

/** Sidebar badge uchun yengil sanoq: jami kvitansiya va to'langan (kelgan) soni. */
export async function buxgalteriyaCounts(snapshotId?: number): Promise<{ total: number; paid: number }> {
  const scope = { receiptNumber: { not: null }, ...(snapshotId ? { snapshotId } : {}) } as const;
  const [total, paid] = await Promise.all([
    prisma.arizaCase.count({ where: scope }),
    prisma.arizaCase.count({ where: { ...scope, stage: { in: PAID_STAGES } } }),
  ]);
  return { total, paid };
}

/** Firmalar bo'yicha boji invoice ro'yxati + holati (tanlangan snapshot uchun). */
export async function buxgalteriyaData(snapshotId?: number): Promise<BxData> {
  const fallback = await getBojiAmount();
  const cases = await prisma.arizaCase.findMany({
    where: { receiptNumber: { not: null }, ...(snapshotId ? { snapshotId } : {}) },
    orderBy: [{ firmId: 'asc' }, { clientName: 'asc' }],
    select: {
      id: true, firmId: true, clientName: true, kod: true, receiptNumber: true, invoiceNo: true, stage: true,
      firm: { select: { shortName: true } },
      // Haqiqiy invoice summasi — narx o'zgaruvchi; kvitansiyaga bog'langan yozuvdan olamiz.
      invoiceRecords: { select: { amount: true }, take: 1 },
    },
  });

  const byFirm = new Map<number, BxFirm>();
  let paidCount = 0;
  let unpaidCount = 0;
  let paidSum = 0;
  let unpaidSum = 0;
  for (const c of cases) {
    const paid = PAID_STAGES.includes(c.stage);
    const locked = paid && c.stage !== 'INVOICE_PAID'; // sud/MIB'ga o'tgan — qulf
    const amount = c.invoiceRecords[0]?.amount != null ? Number(c.invoiceRecords[0].amount) : fallback;
    if (paid) { paidCount += 1; paidSum += amount; } else { unpaidCount += 1; unpaidSum += amount; }
    let f = byFirm.get(c.firmId);
    if (!f) { f = { firmId: c.firmId, firmName: c.firm.shortName, rows: [], total: 0, paid: 0, unpaid: 0, sum: 0, paidSum: 0, unpaidSum: 0 }; byFirm.set(c.firmId, f); }
    f.rows.push({ caseId: c.id, clientName: c.clientName, kod: c.kod, receiptNumber: c.receiptNumber, invoiceNo: c.invoiceNo, amount, paid, locked });
    f.total += 1;
    f.sum += amount;
    if (paid) { f.paid += 1; f.paidSum += amount; } else { f.unpaid += 1; f.unpaidSum += amount; }
  }
  const firms = [...byFirm.values()].sort((a, b) => b.total - a.total);
  return { amount: fallback, firms, total: cases.length, paidCount, unpaidCount, sum: paidSum + unpaidSum, paidSum, unpaidSum };
}
