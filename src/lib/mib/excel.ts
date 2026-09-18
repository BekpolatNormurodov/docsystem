// Build the MIB report as an .xlsx. To'liq eksport: Mijozlar + Ishlar + kesim varaqlari (Firma /
// Region / Hudud / Bank). `opts.tab` bir kesim varag'ini beradi (dashboard tabidan), `opts.clientId`
// bitta mijozning ishlarini beradi. Kesim/region mantig'i src/lib/mib/breakdown.ts dan (dashboard
// bilan bir xil). Pul haqiqiy son bo'lib yoziladi — Excel yig'a/filtrlay oladi.
import ExcelJS from 'exceljs';
import type { MibCase, MibClient, MibReport } from '@prisma/client';
import { parseMoney } from './stats';
import { groupBreakdown, regionFromText, clean, type Dim } from './breakdown';

type ClientWithCases = MibClient & { cases: MibCase[] };

const num = (s: string | null) => (s ? parseMoney(s) : 0);
const txt = (s: string | null) => (s && s !== 'Nomaʼlum' ? s : '');
const UNK = 'Aniqlanmagan';

const DIMS: Dim[] = ['firma', 'region', 'hudud', 'bank'];
const DIM_SHEET: Record<Dim, string> = { firma: 'Firma boʻyicha', region: 'Region boʻyicha', hudud: 'Hudud (MIB)', bank: 'Bank boʻyicha' };
const DIM_HEAD: Record<Dim, string> = { firma: 'Firma', region: 'Region', hudud: 'Hudud (MIB boʻlimi)', bank: 'Bank' };

// Kesim varag'i (Firma/Region/Bank) — 6 ustun: yorliq + hudud/region konteksti + son + summa. «Hudud»
// uchun Region ustuni ham qo'shiladi (qaysi viloyat), «Region» uchun hudud/ijrochi soni.
function addBreakdownSheet(wb: ExcelJS.Workbook, clients: ClientWithCases[], dim: Dim): void {
  const ws = wb.addWorksheet(DIM_SHEET[dim]);
  const extra = dim === 'hudud' ? { header: 'Region', key: 'region', width: 18 } : null;
  ws.columns = [
    { header: DIM_HEAD[dim], key: 'label', width: 46 },
    ...(extra ? [extra] : []),
    { header: 'Ijro ishi', key: 'cases', width: 12 },
    { header: 'Bizniki (MMT)', key: 'ours', width: 14 },
    { header: 'Mijoz', key: 'clients', width: 10 },
    { header: 'Ulush %', key: 'share', width: 10 },
    { header: 'Qoldiq qarz', key: 'debt', width: 20 },
  ];
  const rows = groupBreakdown(clients, dim);
  const totalDebt = rows.reduce((a, r) => a + r.debt, 0) || 1;
  for (const r of rows) {
    const row: Record<string, unknown> = { label: r.label, cases: r.cases, ours: r.ours, clients: r.clients, share: Math.round((r.debt / totalDebt) * 1000) / 10, debt: r.debt };
    if (extra) row.region = regionFromText(r.label) ?? (r.label === UNK ? UNK : ''); // hudud → qaysi viloyat
    ws.addRow(row);
  }
  const t = rows.reduce((a, r) => ({ cases: a.cases + r.cases, ours: a.ours + r.ours, debt: a.debt + r.debt }), { cases: 0, ours: 0, debt: 0 });
  ws.addRow({ label: `Jami · ${rows.length} guruh`, cases: t.cases, ours: t.ours, clients: '', share: 100, debt: t.debt });
  ws.getRow(1).font = { bold: true };
  ws.lastRow!.font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.getColumn('debt').numFmt = '#,##0';
}

// «Ijrochilar boʻyicha» — FAQAT bizning firma ishlari. Har ijrochi: F.I.O, telefon, MIB boʻlimi (hudud),
// region, ishlar/mijozlar soni, qoldiq qarz. Operator ijrochi bilan bogʻlanishi uchun eng muhim varaq.
function addExecutorSheet(wb: ExcelJS.Workbook, clients: ClientWithCases[]): void {
  const ws = wb.addWorksheet('Ijrochilar boʻyicha');
  ws.columns = [
    { header: 'Davlat ijrochisi', key: 'name', width: 30 },
    { header: 'Telefon', key: 'phone', width: 18 },
    { header: 'MIB boʻlimi (hudud)', key: 'dept', width: 28 },
    { header: 'Region', key: 'region', width: 18 },
    { header: 'Ishlar', key: 'cases', width: 9 },
    { header: 'Mijozlar', key: 'clients', width: 10 },
    { header: 'Qoldiq qarz', key: 'debt', width: 20 },
  ];
  type Agg = { name: string; phone: string; dept: string; region: string; cases: number; clients: Set<number>; debt: number };
  const map = new Map<string, Agg>();
  for (const c of clients) {
    for (const k of c.cases) {
      if (!k.isTargetFirm) continue; // faqat bizniki — ijrochi detali shu ishларда bor
      const name = txt(k.executorName) || UNK;
      const phone = txt(k.executorPhone);
      const dept = clean(k.executorDept) || UNK;
      const key = `${name}|${phone}|${dept}`;
      const a = map.get(key) ?? { name, phone, dept, region: regionFromText(txt(k.executorDept) || txt(k.courtOrgan)) ?? UNK, cases: 0, clients: new Set<number>(), debt: 0 };
      a.cases += 1; a.clients.add(c.id); a.debt += num(k.remainingDebt);
      map.set(key, a);
    }
  }
  const rows = [...map.values()].sort((x, y) => y.debt - x.debt || y.cases - x.cases);
  for (const a of rows) ws.addRow({ name: a.name, phone: a.phone, dept: a.dept, region: a.region, cases: a.cases, clients: a.clients.size, debt: a.debt });
  const t = rows.reduce((s, a) => ({ cases: s.cases + a.cases, debt: s.debt + a.debt }), { cases: 0, debt: 0 });
  ws.addRow({ name: `Jami · ${rows.length} ijrochi`, phone: '', dept: '', region: '', cases: t.cases, clients: '', debt: t.debt });
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
  // «Mijozlar» varag'i — UMUMIY (hamma mijoz). «Ishlar» + kesim varaqlari — FAQAT BIZNIKI (Davlat/bank/
  // jarima/pochta xarajati chiqmaydi): operator ijro ro'yxatida faqat o'z firmalarimiz ishlarini
  // ko'rishni xohlaydi (2026-09-18). Bitta mijoz eksporti (opts.clientId) — mustasno, HAMMA ishi kerak.
  const oursClients = opts.clientId
    ? clients
    : clients.map((c) => ({ ...c, cases: c.cases.filter((k) => k.isTargetFirm) })).filter((c) => c.cases.length > 0);

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  // Bitta kesim varag'i (dashboard tabidan «Excel») — kesimlar FAQAT BIZNIKI.
  if (opts.tab === 'ijrochilar') {
    addExecutorSheet(wb, oursClients);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  if (opts.tab && DIMS.includes(opts.tab as Dim)) {
    addBreakdownSheet(wb, oursClients, opts.tab as Dim);
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

  // ── Sheet 2: Ishlar (ijro) — FAQAT BIZNIKI ────────────────────────────────
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
  for (const c of oursClients) {
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
  // «Ijrochilar boʻyicha» — birinchi kesim varaq (eng koʻp soʻraladi), so'ng firma/region/hudud/bank.
  if (!opts.clientId) { addExecutorSheet(wb, oursClients); for (const d of DIMS) addBreakdownSheet(wb, oursClients, d); }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
