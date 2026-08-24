// Keshdagi (BillingCheckInvoice) kvitansiyalarni xlsx qilib eksport qilish.
// Har firma — ALOHIDA varaq (tab 1 = Bright, tab 2 = Urban, …), oxirida «Xulosa» varag'i:
// firma × holat kesimida soni va summasi, alohida ajratilgan «to'langan, ishlatilmagan».
// Summalar tiyingacha (#,##0.00) — billing.sud.uz o'zi shunday ko'rsatadi.
import ExcelJS from 'exceljs';
import type { BillingCheckInvoice } from '@prisma/client';
import { FIRMS, type FirmCfg } from '@/lib/firms';

// billing.sud.uz summalarni TIYINDA qaytaradi (2 060 000 = 20 600,00 so'm). Bazada xom
// holicha saqlanadi — so'mga bu yerda aylantiriladi, shunda Excel'dagi yig'indilar to'g'ri.
const TIYIN = 100;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) / TIYIN);
const MONEY_FMT = '#,##0.00';
const DATE_FMT = 'dd.mm.yyyy hh:mm';

export const STATUS_UZ: Record<string, string> = {
  CREATED: "To'lanmagan",
  PAID: "To'langan (ishlatilmagan)",
  USED: 'Foydalanilgan',
};

const COLUMNS = [
  { header: '№', key: 'no', width: 6 },
  { header: 'Kvitansiya raqami', key: 'number', width: 18 },
  { header: 'Holati', key: 'status', width: 24 },
  { header: 'Egasi', key: 'payer', width: 40 },
  { header: 'STIR/pasport', key: 'tin', width: 16 },
  { header: 'Sud', key: 'court', width: 40 },
  { header: 'Summasi', key: 'amount', width: 16 },
  { header: "To'lanmagan", key: 'mustPay', width: 16 },
  { header: "To'langan", key: 'paid', width: 16 },
  { header: 'Qoldiq', key: 'balance', width: 16 },
  { header: "Da'vo raqami", key: 'claim', width: 20 },
  { header: 'Yaratilgan', key: 'issued', width: 16 },
  { header: 'Amal qilish muddati', key: 'expires', width: 18 },
  { header: 'Tekshirilgan', key: 'checked', width: 18 },
];

function addInvoiceSheet(wb: ExcelJS.Workbook, name: string, rows: BillingCheckInvoice[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = COLUMNS;
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
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  ['amount', 'mustPay', 'paid', 'balance'].forEach((k) => { ws.getColumn(k).numFmt = MONEY_FMT; });
  ['issued', 'expires', 'checked'].forEach((k) => { ws.getColumn(k).numFmt = DATE_FMT; });

  // Oxirida jami qatori — varaqni ochib darrov summani ko'rish uchun.
  if (rows.length) {
    const t = ws.addRow({
      status: 'JAMI',
      amount: rows.reduce((s, r) => s + num(r.amount), 0),
      mustPay: rows.reduce((s, r) => s + num(r.mustPayAmount), 0),
      paid: rows.reduce((s, r) => s + num(r.paidAmount), 0),
      balance: rows.reduce((s, r) => s + num(r.balance), 0),
    });
    t.font = { bold: true };
  }
  return ws;
}

export async function buildBillingCheckExcel(rows: BillingCheckInvoice[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  // Firma bo'yicha guruhlash — FIRMS tartibida (tab 1 = Bright).
  const groups: { name: string; rows: BillingCheckInvoice[] }[] = FIRMS.map((f: FirmCfg) => ({
    name: f.name.replace(/ MIKROMOLIYA.*$/i, '').slice(0, 31), // Excel varaq nomi ≤ 31 belgi
    rows: rows.filter((r) => r.firmCode === f.branchCode),
  }));
  const others = rows.filter((r) => !FIRMS.some((f: FirmCfg) => f.branchCode === r.firmCode));
  if (others.length) groups.push({ name: 'Boshqa', rows: others });

  // Bo'sh firmalar ham varaq sifatida qoladi (tartib barqaror bo'lsin), lekin hech qanday
  // ma'lumot bo'lmasa — hech bo'lmasa bitta varaq chiqsin.
  const nonEmpty = groups.filter((g) => g.rows.length);
  for (const g of (nonEmpty.length ? nonEmpty : groups.slice(0, 1))) addInvoiceSheet(wb, g.name, g.rows);

  // ── Xulosa: firma × holat, + «to'langan, ishlatilmagan» alohida ──────────────
  const s = wb.addWorksheet('Xulosa');
  s.columns = [
    { header: 'Firma', key: 'firm', width: 28 },
    { header: 'Holati', key: 'status', width: 24 },
    { header: 'Soni', key: 'count', width: 10 },
    { header: 'Summasi', key: 'sum', width: 18 },
  ];
  const STATUS_ORDER = ['PAID', 'CREATED', 'USED'];
  for (const g of groups) {
    if (!g.rows.length) continue;
    for (const st of STATUS_ORDER) {
      const sub = g.rows.filter((r) => r.invoiceStatus === st);
      if (!sub.length) continue;
      s.addRow({ firm: g.name, status: STATUS_UZ[st] ?? st, count: sub.length, sum: sub.reduce((a, r) => a + num(r.amount), 0) });
    }
    // Holati ro'yxatdan tashqari bo'lganlar (kutilmagan qiymat) ham yo'qolmasin.
    const rest = g.rows.filter((r) => !STATUS_ORDER.includes(r.invoiceStatus));
    if (rest.length) s.addRow({ firm: g.name, status: rest[0].invoiceStatus, count: rest.length, sum: rest.reduce((a, r) => a + num(r.amount), 0) });
  }
  const unused = rows.filter((r) => r.invoiceStatus === 'PAID');
  s.addRow({});
  const hi = s.addRow({
    firm: 'HAMMASI', status: "To'langan, ishlatilmagan",
    count: unused.length, sum: unused.reduce((a, r) => a + num(r.amount), 0),
  });
  hi.font = { bold: true };
  const all = s.addRow({ firm: 'HAMMASI', status: 'Jami kvitansiya', count: rows.length, sum: rows.reduce((a, r) => a + num(r.amount), 0) });
  all.font = { bold: true };
  s.getRow(1).font = { bold: true };
  s.getColumn('sum').numFmt = MONEY_FMT;
  s.views = [{ state: 'frozen', ySplit: 1 }];

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
