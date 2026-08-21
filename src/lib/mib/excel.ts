// Build the full MIB report as an .xlsx: sheet 1 = per-client summary, sheet 2 = per-case detail
// (every Step 19 field). Money is written as real numbers so Excel can sum/filter.
import ExcelJS from 'exceljs';
import type { MibCase, MibClient, MibReport } from '@prisma/client';
import { parseMoney } from './stats';

type ClientWithCases = MibClient & { cases: MibCase[] };

const num = (s: string | null) => (s ? parseMoney(s) : 0);
const txt = (s: string | null) => (s && s !== 'Nomaʼlum' ? s : '');

export async function buildMibExcel(report: MibReport, clients: ClientWithCases[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  // ── Sheet 1: Mijozlar ─────────────────────────────────────────────────────
  const s1 = wb.addWorksheet('Mijozlar');
  s1.columns = [
    { header: '№', key: 'no', width: 6 },
    { header: 'PINFL', key: 'pinfl', width: 18 },
    { header: 'F.I.O', key: 'fio', width: 34 },
    { header: 'Firma (Excel)', key: 'firm', width: 12 },
    { header: 'Holat (Excel)', key: 'holat', width: 16 },
    { header: 'MIB holati', key: 'status', width: 14 },
    { header: 'Ijro ishlari', key: 'cases', width: 12 },
    { header: 'Jami qarz (mib)', key: 'debt', width: 18 },
    { header: 'Qoldiq (jami)', key: 'remaining', width: 18 },
    { header: 'Tekshirilgan', key: 'checked', width: 18 },
  ];
  const STATUS_UZ: Record<string, string> = { PENDING: 'Navbatda', RUNNING: 'Tekshirilmoqda', DONE: 'Topildi', CLEAN: 'Toza', FAILED: 'Xato' };
  for (const c of clients) {
    const fullName = c.cases.map((k) => k.personFullName).find((nm) => nm && !nm.includes('***') && nm !== 'Nomaʼlum');
    const remaining = c.cases.reduce((s, k) => s + num(k.remainingDebt), 0);
    s1.addRow({
      no: c.rowNo ?? '', pinfl: c.pinfl, fio: fullName || c.fio2 || c.fio || '', firm: c.firm || '', holat: c.holat || '',
      status: STATUS_UZ[c.status] ?? c.status, cases: c.cases.length, debt: num(c.totalDebt), remaining,
      checked: c.checkedAt ? new Date(c.checkedAt) : '',
    });
  }

  // ── Sheet 2: Ishlar (ijro) ────────────────────────────────────────────────
  const s2 = wb.addWorksheet('Ishlar');
  s2.columns = [
    { header: '№', key: 'no', width: 6 },
    { header: 'PINFL', key: 'pinfl', width: 18 },
    { header: 'F.I.O', key: 'fio', width: 34 },
    { header: 'Ijro ishi raqami', key: 'work', width: 20 },
    { header: 'Undiruvchi (firma)', key: 'firm', width: 40 },
    { header: 'INN', key: 'inn', width: 14 },
    { header: 'Sud organi', key: 'court', width: 40 },
    { header: 'Hujjat turi', key: 'doctype', width: 16 },
    { header: 'Hujjat raqami', key: 'docnum', width: 24 },
    { header: 'Hujjat sanasi', key: 'docdate', width: 14 },
    { header: 'Kuchga kirgan', key: 'eff', width: 14 },
    { header: 'Davlat ijrochisi', key: 'exec', width: 30 },
    { header: 'Ijrochi tel', key: 'execphone', width: 20 },
    { header: 'MIB bo‘limi', key: 'dept', width: 22 },
    { header: 'MIBga kelgan', key: 'received', width: 16 },
    { header: 'Qo‘zg‘atilgan', key: 'initiated', width: 20 },
    { header: 'Umumiy summa', key: 'total', width: 16 },
    { header: 'Asosiy qarz', key: 'main', width: 16 },
    { header: 'Ijro yig‘imi', key: 'fee', width: 14 },
    { header: 'Jarima', key: 'fine', width: 14 },
    { header: 'Qoldiq qarz', key: 'remaining', width: 16 },
    { header: 'Bank', key: 'bank', width: 30 },
    { header: 'MFO', key: 'mfo', width: 10 },
    { header: 'Hisob raqami', key: 'account', width: 24 },
    { header: 'Qarorlar', key: 'decisions', width: 40 },
  ];
  for (const c of clients) {
    const fullName = c.cases.map((k) => k.personFullName).find((nm) => nm && !nm.includes('***') && nm !== 'Nomaʼlum') || c.fio2 || c.fio || '';
    if (!c.cases.length) continue;
    for (const k of c.cases) {
      const dec = Array.isArray(k.decisions) ? (k.decisions as { article: string; date: string }[]).map((d) => `${d.article} (${d.date})`).join('; ') : '';
      s2.addRow({
        no: c.rowNo ?? '', pinfl: c.pinfl, fio: fullName, work: k.workNumber,
        firm: txt(k.firmName), inn: txt(k.firmInn), court: txt(k.courtOrgan), doctype: txt(k.courtDocType), docnum: txt(k.courtDocNumber),
        docdate: txt(k.courtDocDate), eff: txt(k.courtEffectiveDate), exec: txt(k.executorName), execphone: txt(k.executorPhone), dept: txt(k.executorDept),
        received: txt(k.mibReceivedDate), initiated: txt(k.mibInitiatedDate),
        total: num(k.totalAmount), main: num(k.mainDebt), fee: num(k.executionFee), fine: num(k.fine), remaining: num(k.remainingDebt),
        bank: txt(k.bankName), mfo: txt(k.bankMfo), account: txt(k.bankAccount), decisions: dec,
      });
    }
  }

  // Header styling + money number format on both sheets.
  for (const ws of [s1, s2]) {
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  ['debt', 'remaining'].forEach((k) => { const col = s1.getColumn(k); col.numFmt = '#,##0'; });
  ['total', 'main', 'fee', 'fine', 'remaining'].forEach((k) => { const col = s2.getColumn(k); col.numFmt = '#,##0'; });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
