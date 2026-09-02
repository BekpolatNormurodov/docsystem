// Buxgalteriya farmoyishi — EXCEL (.xlsx) variant. Word farmoyishning jadval ma'lumoti: №, Қарздор
// ФИО, Код, Почта харажати, Квитанция рақами (+ JAMI). buildFarmoyishDocx / buildFarmoyishForFirm
// bilan bir xil ma'lumotni oladi, faqat xlsx qilib qaytaradi.
import ExcelJS from 'exceljs';
import { prisma } from './db';
import { POSTAL_FEE } from './konveyer-buxgalter';

const pad = (n: number) => String(n).padStart(2, '0');
interface Row { clientName: string | null; kod: string | null; receiptNumber: string | null }

async function rowsToXlsx(legalName: string, rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Farmoyish');
  ws.columns = [
    { header: '№', key: 'no', width: 6 },
    { header: 'Қарздор ФИО', key: 'name', width: 40 },
    { header: 'Код', key: 'kod', width: 14 },
    { header: 'Почта харажати', key: 'fee', width: 16 },
    { header: 'Квитанция рақами', key: 'receipt', width: 22 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
  const valid = rows.filter((r) => r.receiptNumber);
  valid.forEach((r, i) => {
    const row = ws.addRow({ no: i + 1, name: r.clientName ?? '', kod: r.kod ?? '', fee: POSTAL_FEE, receipt: r.receiptNumber ?? '' });
    row.getCell('fee').numFmt = '#,##0';
  });
  const total = ws.addRow({ name: `${legalName} — jami`, fee: POSTAL_FEE * valid.length, receipt: `${valid.length} ta` });
  total.font = { bold: true };
  total.getCell('fee').numFmt = '#,##0';
  ws.getColumn('receipt').alignment = { horizontal: 'left' };
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** Bitta partiya (InvoiceBatch) uchun farmoyish Excel. */
export async function buildFarmoyishExcel(batchId: number): Promise<{ buffer: Buffer; fileName: string }> {
  const batch = await prisma.invoiceBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { firm: true, cases: { orderBy: { id: 'asc' }, select: { clientName: true, kod: true, receiptNumber: true } } },
  });
  const buffer = await rowsToXlsx(batch.firm.legalName || batch.firm.shortName, batch.cases);
  const safe = batch.firm.shortName.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return { buffer, fileName: `Farmoyish_${safe}_${batchId}.xlsx` };
}

/** Bitta firmaning barcha kvitansiyalari (tanlangan snapshot) uchun farmoyish Excel. */
export async function buildFarmoyishExcelForFirm(firmId: number, snapshotId?: number): Promise<{ buffer: Buffer; fileName: string } | null> {
  const [firm, snap, cases] = await Promise.all([
    prisma.firm.findUnique({ where: { id: firmId } }),
    snapshotId ? prisma.snapshot.findUnique({ where: { id: snapshotId }, select: { reportDate: true } }) : Promise.resolve(null),
    prisma.arizaCase.findMany({
      where: { firmId, receiptNumber: { not: null }, ...(snapshotId ? { snapshotId } : {}) },
      orderBy: [{ clientName: 'asc' }, { id: 'asc' }],
      select: { clientName: true, kod: true, receiptNumber: true },
    }),
  ]);
  if (!firm || cases.length === 0) return null;
  const date = snap?.reportDate ?? new Date();
  const buffer = await rowsToXlsx(firm.legalName || firm.shortName, cases);
  const safe = firm.shortName.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  const dstr = `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
  return { buffer, fileName: `Farmoyish_${safe}_${dstr}.xlsx` };
}
