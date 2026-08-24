// Keshdagi (BillingCheckInvoice) kvitansiyalarni bitta xlsx qilib eksport qilish — firma/holat
// bo'yicha filtrlangan ro'yxat. src/lib/mib/excel.ts uslubiga mos.
import ExcelJS from 'exceljs';
import type { BillingCheckInvoice } from '@prisma/client';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

const STATUS_UZ: Record<string, string> = {
  CREATED: "To'lanmagan",
  PAID: "To'liq to'langan",
  USED: 'Foydalanilgan',
};

export async function buildBillingCheckExcel(rows: BillingCheckInvoice[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet('Kvitansiyalar');
  ws.columns = [
    { header: '№', key: 'no', width: 6 },
    { header: 'Kvitansiya raqami', key: 'number', width: 18 },
    { header: 'Holati', key: 'status', width: 16 },
    { header: 'Egasi', key: 'payer', width: 40 },
    { header: 'STIR/pasport', key: 'tin', width: 16 },
    { header: 'Sud', key: 'court', width: 40 },
    { header: 'Summasi', key: 'amount', width: 16 },
    { header: "To'lanmagan", key: 'mustPay', width: 16 },
    { header: "To'langan", key: 'paid', width: 16 },
    { header: 'Qoldiq', key: 'balance', width: 16 },
    { header: "Da'vo raqami", key: 'claim', width: 20 },
    { header: 'Yaratilgan', key: 'issued', width: 14 },
    { header: 'Amal qilish muddati', key: 'expires', width: 16 },
    { header: 'Tekshirilgan', key: 'checked', width: 18 },
  ];
  rows.forEach((r, i) => {
    ws.addRow({
      no: i + 1,
      number: r.number,
      status: STATUS_UZ[r.invoiceStatus] ?? r.invoiceStatus,
      payer: r.payer ?? '',
      tin: r.payerTin ?? '',
      court: r.court ?? '',
      amount: num(r.amount),
      mustPay: num(r.mustPayAmount),
      paid: num(r.paidAmount),
      balance: num(r.balance),
      claim: r.claimCaseNumber ?? '',
      issued: r.issuedAt ?? '',
      expires: r.expiresAt ?? '',
      checked: r.checkedAt,
    });
  });
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ['amount', 'mustPay', 'paid', 'balance'].forEach((k) => { ws.getColumn(k).numFmt = '#,##0'; });
  ['issued', 'expires', 'checked'].forEach((k) => { ws.getColumn(k).numFmt = 'dd.mm.yyyy hh:mm'; });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
