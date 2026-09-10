// Build the MIB report as an .xlsx. To'liq eksport: Mijozlar + Ishlar + kesim varaqlari (Firma /
// Region / Hudud / Bank). `opts.tab` bir kesim varag'ini beradi (dashboard tabidan), `opts.clientId`
// bitta mijozning ishlarini beradi. Kesim/region mantig'i src/lib/mib/breakdown.ts dan (dashboard
// bilan bir xil). Pul haqiqiy son bo'lib yoziladi — Excel yig'a/filtrlay oladi.
import ExcelJS from 'exceljs';
import type { MibCase, MibClient, MibReport } from '@prisma/client';
import { parseMoney } from './stats';
import { groupBreakdown, type Dim } from './breakdown';

type ClientWithCases = MibClient & { cases: MibCase[] };

const num = (s: string | null) => (s ? parseMoney(s) : 0);
const txt = (s: string | null) => (s && s !== 'Nomaʼlum' ? s : '');

const DIMS: Dim[] = ['firma', 'region', 'hudud', 'bank'];
const DIM_SHEET: Record<Dim, string> = { firma: 'Firma boʻyicha', region: 'Region boʻyicha', hudud: 'Hudud (MIB)', bank: 'Bank boʻyicha' };
const DIM_HEAD: Record<Dim, string> = { firma: 'Firma', region: 'Region', hudud: 'Hudud (MIB boʻlimi)', bank: 'Bank' };

function addBreakdownSheet(wb: ExcelJS.Workbook, clients: ClientWithCases[], dim: Dim): void {
  const ws = wb.addWorksheet(DIM_SHEET[dim]);
  ws.columns = [
    { header: DIM_HEAD[dim], key: 'label', width: 46 },
    { header: 'Ijro ishi', key: 'cases', width: 12 },
    { header: 'Bizniki (8 MMT)', key: 'ours', width: 16 },
    { header: 'Mijoz', key: 'clients', width: 10 },
    { header: 'Qoldiq qarz', key: 'debt', width: 20 },
  ];
  const rows = groupBreakdown(clients, dim);
  for (const r of rows) ws.addRow(r);
  const t = rows.reduce((a, r) => ({ cases: a.cases + r.cases, ours: a.ours + r.ours, debt: a.debt + r.debt }), { cases: 0, ours: 0, debt: 0 });
  ws.addRow({ label: `Jami · ${rows.length} guruh`, cases: t.cases, ours: t.ours, clients: '', debt: t.debt });
  ws.getRow(1).font = { bold: true };
  ws.lastRow!.font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.getColumn('debt').numFmt = '#,##0';
}

export async function buildMibExcel(
  report: MibReport,
  clients: ClientWithCases[],
  opts: { tab?: string; clientId?: number } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  // Bitta kesim varag'i (dashboard tabidan «Excel»).
  if (opts.tab && DIMS.includes(opts.tab as Dim)) {
    addBreakdownSheet(wb, clients, opts.tab as Dim);
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

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

  // To'liq hisobotga kesim varaqlarini ham qo'shamiz (bitta mijoz eksportida shart emas).
  if (!opts.clientId) for (const d of DIMS) addBreakdownSheet(wb, clients, d);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
