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

  // ── Workbook ───────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const money = (ws: ExcelJS.Worksheet, keys: string[]) => keys.forEach((k) => { ws.getColumn(k).numFmt = '#,##0'; });
  const headStyle = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { vertical: 'middle', wrapText: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };

  // 1) Sud roʻyxati — har qator bitta shartnoma
  const s1 = wb.addWorksheet(t('Sud roʻyxati'));
  s1.columns = [
    { header: '№', key: 'no', width: 6 },
    { header: t('МКО'), key: 'firma', width: 22 },
    { header: t('PINFL'), key: 'pinfl', width: 16 },
    { header: t('F.I.O.'), key: 'fio', width: 28 },
    { header: t('Ssuda hisobi'), key: 'acc', width: 22 },
    { header: t('Shartnoma'), key: 'ld', width: 14 },
    { header: t('Mahsulot'), key: 'prod', width: 16 },
    { header: t('Klassifikatsiya'), key: 'klass', width: 16 },
    { header: t('Holati'), key: 'status', width: 14 },
    { header: t('Kredit summasi'), key: 'summ', width: 16 },
    { header: t('Stavka (%)'), key: 'rate', width: 10 },
    { header: t('Berilgan sana'), key: 'd1', width: 13 },
    { header: t('Yopilish sana'), key: 'd2', width: 13 },
    { header: t('Asosiy qarz'), key: 'p', width: 16 },
    { header: t('Muddati oʻtgan asosiy'), key: 'op', width: 18 },
    { header: t('Foizlar'), key: 'i', width: 14 },
    { header: t('Muddati oʻtgan foiz'), key: 'oi', width: 16 },
    { header: t('Muddati oʻtgan jami'), key: 'od', width: 18 },
    { header: t('Jami qarz (bankka)'), key: 'total', width: 18 },
    { header: t('Viloyat'), key: 'reg', width: 16 },
    { header: t('Telefon'), key: 'phone', width: 14 },
    { header: t('Manzil'), key: 'addr', width: 34 },
    { header: t('Sudga chiqarilgan'), key: 'sud', width: 15 },
  ];
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
  headStyle(s1);
  money(s1, ['summ', 'p', 'op', 'i', 'oi', 'od', 'total']);
  ['d1', 'd2'].forEach((k) => { s1.getColumn(k).numFmt = 'dd.mm.yyyy'; });
  s1.autoFilter = { from: 'A1', to: { row: 1, column: s1.columnCount } };

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
  s2.columns = [{ header: '', key: 'k', width: 34 }, { header: '', key: 'v', width: 22 }];
  const line = (k: string, v: string | number) => s2.addRow({ k, v });
  line(t('Snapshot (sana)'), snapLabel);
  line(t('Shartnomalar (kredit)'), all.loans);
  line(t('Mijozlar (kishi)'), all.clients.size);
  line(t('Sudga chiqarilgan (mijoz)'), submittedClients.size);
  line(t('Asosiy qarz'), all.principal);
  line(t('Muddati oʻtgan jami'), all.overdue);
  line(t('Jami qarz (bankka)'), all.total);
  s2.getRow(1).font = { bold: true };
  s2.getColumn('v').numFmt = '#,##0';

  const table = (title: string, m: Map<string, Agg>) => {
    s2.addRow({}); const hr = s2.addRow({ k: title, v: '' }); hr.font = { bold: true };
    const cols = s2.addRow({ k: t('Nomi'), v: t('Shartnoma') }); cols.font = { bold: true };
    cols.getCell('C').value = t('Mijoz'); cols.getCell('D').value = t('Jami qarz');
    const rows = [...m.entries()].sort((a, b) => b[1].total - a[1].total);
    for (const [key, a] of rows) {
      const r = s2.addRow({ k: key, v: a.loans });
      r.getCell('C').value = a.clients.size; r.getCell('D').value = a.total;
    }
  };
  // C/D ustunlar sarlavhasi (qo'shimcha ustunlar table() ichida to'ladi).
  s2.getCell('C1').value = ''; s2.getColumn('C').width = 14; s2.getColumn('D').width = 20; s2.getColumn('D').numFmt = '#,##0';
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
