import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import ExcelJS from 'exceljs';
import { requireAccess } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { konveyerSnapshots } from '@/lib/konveyer';
import { getT } from '@/lib/i18n/server';
import { regionFromText } from '@/lib/mib/breakdown';

export const runtime = 'nodejs';
export const maxDuration = 120;

// «форма_суд» — sudga topshiriladigan portfel-analitik forma. QAMROV: sud roʻyxati (Loan.excluded=1).
// Manba: Loan ustunlari (raw kerak emas). Til: tepadagi til (getT → lang cookie). Har qator — bitta
// shartnoma (kredit). «qoʻshimchalar»: Xulosa varagʻi (firma / viloyat / klassifikatsiya / sud holati).

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
// Sudga chiqarilgan bosqichlar (ArizaCase.stage) — «Судга киритилган» ustuni shu bilan aniqlanadi.
const SUBMITTED_STAGES = new Set(['COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED']);
// Eng ilgarilagan bosqich (bir mijozda bir necha ish bo'lsa) — tartib bo'yicha.
const STAGE_ORDER = ['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];
const rank = (s: string) => { const i = STAGE_ORDER.indexOf(s); return i < 0 ? 0 : i; };

export async function GET(req: NextRequest) {
  await requireAccess('sud:send');
  const t = getT();
  const snaps = await konveyerSnapshots().catch(() => []);
  const q = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = q ? Number(q) : NaN;
  const snapId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  if (!snapId) return NextResponse.json({ error: 'Snapshot topilmadi' }, { status: 400 });
  const snapLabel = snaps.find((s) => s.id === snapId)?.label ?? '—';
  const firmFilter = req.nextUrl.searchParams.get('firm'); // ixtiyoriy branchCode

  // Sud roʻyxati loanlari (excluded=1) — faqat kerakli ustunlar (raw'siz, yengil).
  const loans = await prisma.loan.findMany({
    where: { snapshotId: snapId, excluded: true, ...(firmFilter ? { branchCode: firmFilter } : {}) },
    select: {
      pinfl: true, clientName: true, branchCode: true, account: true, ldId: true,
      klassName: true, statusName: true, termType: true, summKr: true, rate: true,
      dateToCr: true, dateClose: true, debtPrincipal: true, debtTermInterest: true,
      debtOverduePrincipal: true, debtOverdueInterest: true, totalDebt: true,
      regionName: true, phone: true, postAddressUz: true, postAddress: true,
    },
    orderBy: [{ branchCode: 'asc' }, { clientName: 'asc' }],
  });

  const firms = await prisma.firm.findMany({ select: { code: true, shortName: true } });
  const firmByCode = new Map(firms.map((f) => [f.code, f.shortName]));

  // Sud holati (ArizaCase bosqichi) — mijoz (PINFL) bo'yicha eng ilgarilagan bosqich.
  const pinfls = [...new Set(loans.map((l) => l.pinfl).filter(Boolean) as string[])];
  const stageByPinfl = new Map<string, string>();
  if (pinfls.length) {
    const acRows = await prisma.arizaCase.findMany({ where: { snapshotId: snapId, pinfl: { in: pinfls } }, select: { pinfl: true, stage: true } });
    for (const a of acRows) {
      if (!a.pinfl) continue;
      const cur = stageByPinfl.get(a.pinfl);
      if (!cur || rank(a.stage) > rank(cur)) stageByPinfl.set(a.pinfl, a.stage);
    }
  }
  const region = (rn: string | null) => regionFromText(rn ?? '') ?? t('Aniqlanmagan');

  // ── Workbook (professional styling) ──────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.creator = 'Yurist Tizimi';
  // Palitra
  const C_TITLE = 'FF134E4A', C_HEAD = 'FF0F766E', C_SECT = 'FFD1EDE7', C_TOT = 'FFEEF2F6', C_BORDER = 'FFD1D5DB', C_ZEBRA = 'FFF7FAF9';
  const thin = { style: 'thin' as const, color: { argb: C_BORDER } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const colL = (nn: number) => { let s = ''; let n = nn; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const MONEY = '#,##0';

  // 1) Sud roʻyxati — har qator bitta shartnoma
  const s1 = wb.addWorksheet(t('Sud roʻyxati'), { views: [{ state: 'frozen', ySplit: 3 }] });
  type Col = { key: string; w: number; h: string; money?: boolean; date?: boolean; center?: boolean };
  const COLS: Col[] = [
    { key: 'no', w: 6, h: '№', center: true },
    { key: 'firma', w: 22, h: t('МКО') },
    { key: 'pinfl', w: 16, h: t('PINFL') },
    { key: 'fio', w: 30, h: t('F.I.O.') },
    { key: 'acc', w: 22, h: t('Ssuda hisobi') },
    { key: 'ld', w: 12, h: t('Shartnoma'), center: true },
    { key: 'prod', w: 16, h: t('Mahsulot') },
    { key: 'klass', w: 16, h: t('Klassifikatsiya') },
    { key: 'status', w: 14, h: t('Holati') },
    { key: 'summ', w: 16, h: t('Kredit summasi'), money: true },
    { key: 'rate', w: 9, h: t('Stavka (%)'), center: true },
    { key: 'd1', w: 13, h: t('Berilgan sana'), date: true },
    { key: 'd2', w: 13, h: t('Yopilish sana'), date: true },
    { key: 'p', w: 16, h: t('Asosiy qarz'), money: true },
    { key: 'op', w: 16, h: t('Muddati oʻtgan asosiy'), money: true },
    { key: 'i', w: 14, h: t('Foizlar'), money: true },
    { key: 'oi', w: 15, h: t('Muddati oʻtgan foiz'), money: true },
    { key: 'od', w: 16, h: t('Muddati oʻtgan jami'), money: true },
    { key: 'total', w: 18, h: t('Jami qarz (bankka)'), money: true },
    { key: 'reg', w: 16, h: t('Viloyat') },
    { key: 'phone', w: 14, h: t('Telefon') },
    { key: 'addr', w: 34, h: t('Manzil') },
    { key: 'sud', w: 15, h: t('Sudga chiqarilgan'), center: true },
  ];
  const NC = COLS.length, last = colL(NC);
  s1.columns = COLS.map((c) => ({ key: c.key, width: c.w }));

  // Sarlavha bloki (1-2 qator)
  s1.mergeCells(`A1:${last}1`);
  const tc = s1.getCell('A1');
  tc.value = t('SUD FORMASI').toUpperCase();
  tc.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  tc.fill = fill(C_TITLE); tc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  s1.getRow(1).height = 26;
  s1.mergeCells(`A2:${last}2`);
  const sc = s1.getCell('A2');
  sc.value = `${t('Snapshot')}: ${snapLabel}   ·   ${t('Sud roʻyxati')}: ${loans.length.toLocaleString('ru-RU')} ${t('shartnoma')}`;
  sc.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
  sc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  s1.getRow(2).height = 16;

  // Sarlavha qatori (3-qator)
  const hr = s1.getRow(3); hr.height = 30;
  COLS.forEach((c, idx) => {
    const cell = hr.getCell(idx + 1);
    cell.value = c.h;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(C_HEAD);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = box;
  });

  // Ma'lumot qatorlari (4-qatordan)
  let i = 0;
  for (const l of loans) {
    const stage = l.pinfl ? stageByPinfl.get(l.pinfl) : undefined;
    s1.addRow({
      no: ++i,
      firma: firmByCode.get(l.branchCode ?? '') ?? l.branchCode ?? '',
      pinfl: l.pinfl ?? '', fio: l.clientName ?? '', acc: l.account ?? '', ld: l.ldId ?? '',
      prod: l.termType ?? '', klass: l.klassName ?? '', status: l.statusName ?? '',
      summ: num(l.summKr), rate: num(l.rate),
      d1: l.dateToCr ?? null, d2: l.dateClose ?? null,
      p: num(l.debtPrincipal), op: num(l.debtOverduePrincipal), i: num(l.debtTermInterest), oi: num(l.debtOverdueInterest),
      od: num(l.debtOverduePrincipal) + num(l.debtOverdueInterest), total: num(l.totalDebt),
      reg: region(l.regionName), phone: l.phone ?? '', addr: l.postAddressUz || l.postAddress || '',
      sud: stage && SUBMITTED_STAGES.has(stage) ? t('Ha') : t('Yoʻq'),
    });
  }
  const dataFrom = 4, dataTo = 3 + loans.length;
  // Ustun formatlari + tekislash (katta varaq: hujayra-chegara/zebra YO'Q — fayl shishmasin/tez).
  COLS.forEach((c, idx) => {
    const col = s1.getColumn(idx + 1);
    if (c.money) col.numFmt = MONEY;
    if (c.date) col.numFmt = 'dd.mm.yyyy';
    if (c.center) col.alignment = { horizontal: 'center' };
  });

  // JAMI qatori — jonli SUM formulalari
  if (loans.length) {
    const tr = s1.getRow(dataTo + 1); tr.height = 18;
    tr.getCell(2).value = t('JAMI');
    for (let cidx = 1; cidx <= NC; cidx++) {
      const cell = tr.getCell(cidx);
      cell.font = { bold: true };
      cell.fill = fill(C_TOT);
      cell.border = { top: { style: 'medium', color: { argb: C_HEAD } }, bottom: thin, left: thin, right: thin };
      if (COLS[cidx - 1].money) { cell.value = { formula: `SUM(${colL(cidx)}${dataFrom}:${colL(cidx)}${dataTo})` }; cell.numFmt = MONEY; }
    }
  }
  s1.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: NC } };

  // ── Xulosa (qoʻshimcha analitika) ────────────────────────────────────────────
  type Agg = { loans: number; clients: Set<string>; principal: number; overdue: number; total: number };
  const mk = (): Agg => ({ loans: 0, clients: new Set(), principal: 0, overdue: 0, total: 0 });
  const byFirm = new Map<string, Agg>(), byRegion = new Map<string, Agg>(), byKlass = new Map<string, Agg>();
  const all = mk();
  const submittedClients = new Set<string>();
  const add = (m: Map<string, Agg>, key: string, l: (typeof loans)[number]) => {
    const a = m.get(key) ?? mk(); m.set(key, a);
    a.loans += 1; if (l.pinfl) a.clients.add(l.pinfl);
    a.principal += num(l.debtPrincipal); a.overdue += num(l.debtOverduePrincipal) + num(l.debtOverdueInterest); a.total += num(l.totalDebt);
  };
  for (const l of loans) {
    add(byFirm, firmByCode.get(l.branchCode ?? '') ?? l.branchCode ?? '—', l);
    add(byRegion, region(l.regionName), l);
    add(byKlass, l.klassName || '—', l);
    all.loans += 1; if (l.pinfl) all.clients.add(l.pinfl);
    all.principal += num(l.debtPrincipal); all.overdue += num(l.debtOverduePrincipal) + num(l.debtOverdueInterest); all.total += num(l.totalDebt);
    const stage = l.pinfl ? stageByPinfl.get(l.pinfl) : undefined;
    if (l.pinfl && stage && SUBMITTED_STAGES.has(stage)) submittedClients.add(l.pinfl);
  }

  const s2 = wb.addWorksheet(t('Xulosa'));
  s2.columns = [{ key: 'k', width: 32 }, { key: 'v', width: 16 }, { key: 'c', width: 14 }, { key: 'd', width: 20 }];
  s2.mergeCells('A1:D1');
  const x1 = s2.getCell('A1');
  x1.value = t('XULOSA').toUpperCase(); x1.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  x1.fill = fill(C_TITLE); x1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  s2.getRow(1).height = 24;

  // KPI bloki
  const kpi = (k: string, v: string | number, money = false) => {
    const r = s2.addRow({ k, v });
    r.getCell(1).font = { bold: true }; r.getCell(1).border = box; r.getCell(1).fill = fill(C_SECT);
    const vc = r.getCell(2); vc.border = box; vc.alignment = { horizontal: 'right' }; if (money && typeof v === 'number') vc.numFmt = MONEY;
  };
  s2.addRow({});
  kpi(t('Snapshot (sana)'), snapLabel);
  kpi(t('Shartnomalar (kredit)'), all.loans);
  kpi(t('Mijozlar (kishi)'), all.clients.size);
  kpi(t('Sudga chiqarilgan (mijoz)'), submittedClients.size);
  kpi(t('Asosiy qarz'), all.principal, true);
  kpi(t('Muddati oʻtgan jami'), all.overdue, true);
  kpi(t('Jami qarz (bankka)'), all.total, true);

  const table = (title: string, m: Map<string, Agg>) => {
    s2.addRow({});
    const secR = s2.addRow({ k: title });
    s2.mergeCells(`A${secR.number}:D${secR.number}`);
    secR.getCell(1).font = { bold: true, size: 11, color: { argb: C_TITLE } };
    secR.getCell(1).fill = fill(C_SECT); secR.getCell(1).alignment = { indent: 1 };
    const hh = s2.addRow({ k: t('Nomi'), v: t('Shartnoma'), c: t('Mijoz'), d: t('Jami qarz') });
    [1, 2, 3, 4].forEach((n) => { const cl = hh.getCell(n); cl.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cl.fill = fill(C_HEAD); cl.border = box; cl.alignment = { horizontal: n === 1 ? 'left' : 'right' }; });
    const rows = [...m.entries()].sort((a, b) => b[1].total - a[1].total);
    let zebra = false;
    for (const [key, a] of rows) {
      const r = s2.addRow({ k: key, v: a.loans, c: a.clients.size, d: a.total });
      zebra = !zebra;
      [1, 2, 3, 4].forEach((n) => { const cl = r.getCell(n); cl.border = box; if (n > 1) cl.alignment = { horizontal: 'right' }; if (zebra) cl.fill = fill(C_ZEBRA); });
      r.getCell(4).numFmt = MONEY;
    }
    // Bo'lim JAMI
    const tot = [...m.values()].reduce((x, a) => ({ l: x.l + a.loans, t: x.t + a.total }), { l: 0, t: 0 });
    const tr = s2.addRow({ k: t('JAMI'), v: tot.l, d: tot.t });
    [1, 2, 3, 4].forEach((n) => { const cl = tr.getCell(n); cl.font = { bold: true }; cl.fill = fill(C_TOT); cl.border = box; if (n > 1) cl.alignment = { horizontal: 'right' }; });
    tr.getCell(4).numFmt = MONEY;
  };
  table(t('Firma boʻyicha'), byFirm);
  table(t('Viloyat boʻyicha'), byRegion);
  table(t('Klassifikatsiya boʻyicha'), byKlass);

  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const name = `Sud_formasi_${snapLabel.replace(/[^\p{L}\p{N}]+/gu, '_')}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}
