import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { canAccess, landingHref } from '@/lib/access';
import { prisma } from '@/lib/db';
import { konveyerSnapshots } from '@/lib/konveyer';
import { getT } from '@/lib/i18n/server';
import { regionFromText } from '@/lib/mib/breakdown';
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const maxDuration = 120;

// «форма_суд» — sudga topshiriladigan portfel-analitik forma (foydalanuvchi bergan 31-ustunli spec).
// QAMROV: sud roʻyxati (Loan.excluded=1). Har qator — bitta shartnoma (kredit). Manba: Loan ustunlari +
// PalataScan (imzolangan ariza skani) + CourtQueueItem (sudga yuborish navbati) + CourtFeeInvoice
// (davlat boji). Formula ustunlar (просроченная задолженность / уникальные клиенты / закрыт полностью)
// JS'da hisoblanadi. Til: tepadagi til (getT). «qoʻshimchalar»: Xulosa varagʻi.

const num = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const SUBMITTED_STAGES = new Set(['COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED']);
const STAGE_ORDER = ['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];
const rank = (s: string) => { const i = STAGE_ORDER.indexOf(s); return i < 0 ? 0 : i; };
// CourtQueueState.enum (schema.prisma) → user-friendly Uzbek yorliqlari (t() orqali tanlangan tilga).
const QUEUE_LABEL_KEY: Record<string, string> = {
  PENDING: 'Navbatda',
  RUNNING: 'Ketmoqda',
  DONE: 'Yuborildi',
  FAILED: 'Xato',
  SKIPPED: 'Oʻtkazib yuborildi',
};

export async function GET(req: NextRequest) {
  // Kim ochadi: sud:send (asosiy iste'molchi) YOKI boss-report (Hisobot sahifasidagi tugma).
  // requireAccess bittasini tekshiradi, boshqasiga ruxsat bermaydi — shu yerda 2ta variantni ochamiz.
  const u = await requireUser();
  if (!canAccess(u, 'sud:send') && !canAccess(u, 'boss-report')) redirect(landingHref(u) ?? '/login');
  const t = getT();
  const snaps = await konveyerSnapshots().catch(() => []);
  const q = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = q ? Number(q) : NaN;
  const snapId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  if (!snapId) return NextResponse.json({ error: 'Snapshot topilmadi' }, { status: 400 });
  const snapLabel = snaps.find((s) => s.id === snapId)?.label ?? '—';
  const firmFilter = req.nextUrl.searchParams.get('firm');

  // Sud roʻyxati loanlari (excluded=1).
  const loans = await prisma.loan.findMany({
    where: { snapshotId: snapId, excluded: true, ...(firmFilter ? { branchCode: firmFilter } : {}) },
    select: {
      pinfl: true, clientName: true, passportSn: true, branchCode: true, account: true, ldId: true,
      klassName: true, summKr: true, rate: true, dateToCr: true, dateClose: true, excluded: true,
      debtPrincipal: true, debtTermInterest: true, debtOverduePrincipal: true, debtOverdueInterest: true,
      totalDebt: true, regionName: true, phone: true, postAddressUz: true, postAddress: true,
    },
    orderBy: [{ branchCode: 'asc' }, { clientName: 'asc' }],
  });

  const firms = await prisma.firm.findMany({ select: { id: true, code: true, shortName: true } });
  const firmByCode = new Map(firms.map((f) => [f.code, f.shortName]));
  const firmIdByCode = new Map(firms.map((f) => [f.code, f.id]));
  const region = (rn: string | null) => regionFromText(rn ?? '') ?? t('Aniqlanmagan');
  const keyOf = (pinfl: string | null, branchCode: string | null) => { if (!pinfl) return null; const fid = firmIdByCode.get(branchCode ?? ''); return fid == null ? null : `${pinfl}|${fid}`; };
  // PalataScan.firmKey (BRIGHT/URBAN/…) → firmId: shortName ichida firmKey bor firma (palata-attach qoidasi).
  const resolveFirmId = (firmKey: string): number | null => { const key = (firmKey || '').toUpperCase(); if (!key) return null; return firms.find((x) => (x.shortName || '').toUpperCase().includes(key))?.id ?? null; };

  const pinfls = [...new Set(loans.map((l) => l.pinfl).filter(Boolean) as string[])];

  // ArizaCase — (pinfl,firmId) → {caseId, stage, courtCaseId}. Sud holati + navbat/boj ulash uchun.
  // MUHIM: Palata skani / navbat / boj — bular JORIY ISHLOV HOLATI (report snapshotiga bog'liq emas,
  // hammasi eng oxirgi snapshotda yig'iladi). Shuning uchun ular PINFL/ish bo'yicha, snapshotSIZ
  // bog'lanadi — aks holda eski snapshot tanlansa ustunlar bo'sh chiqadi (cabinet-status gotcha kabi).
  // Sud holati (stage/«sudga chiqarilgan») esa report snapshotiga bog'liq (caseByKey).
  const caseByKey = new Map<string, { stage: string }>();
  const palataByKey = new Map<string, { reg: string; pages: string }>(); // kalit: pinfl|firmId (firma bo'yicha aniq)
  const queueByKey = new Map<string, { state: string; lastError: string | null; draftId: string | null }>();
  if (pinfls.length) {
    const [acRows, psRows, qRows] = await Promise.all([
      // Stage — report snapshotidagi ish bo'yicha.
      prisma.arizaCase.findMany({ where: { snapshotId: snapId, pinfl: { in: pinfls } }, select: { pinfl: true, firmId: true, stage: true } }),
      // Palata skani — pinfl+firma bo'yicha (snapshotsiz), eng oxirgisi. firmKey → firmId.
      prisma.palataScan.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, reg: true, pages: true, firmKey: true }, orderBy: { createdAt: 'desc' } }),
      // Navbat — ish (pinfl+firma) bo'yicha (snapshotsiz), eng oxirgisi.
      prisma.courtQueueItem.findMany({ where: { case: { pinfl: { in: pinfls } } }, select: { state: true, lastError: true, draftId: true, case: { select: { pinfl: true, firmId: true } } }, orderBy: { updatedAt: 'desc' } }),
    ]);
    for (const a of acRows) {
      if (!a.pinfl) continue;
      const k = `${a.pinfl}|${a.firmId}`;
      const cur = caseByKey.get(k);
      if (!cur || rank(a.stage) > rank(cur.stage)) caseByKey.set(k, { stage: a.stage });
    }
    for (const p of psRows) {
      const fid = resolveFirmId(p.firmKey); if (fid == null) continue;
      const k = `${p.pinfl}|${fid}`;
      if (!palataByKey.has(k)) palataByKey.set(k, { reg: p.reg, pages: p.pages });
    }
    for (const x of qRows) {
      const c = x.case; if (!c?.pinfl) continue;
      const k = `${c.pinfl}|${c.firmId}`;
      if (!queueByKey.has(k)) queueByKey.set(k, { state: x.state, lastError: x.lastError, draftId: x.draftId });
    }
  }

  // CourtFeeInvoice — davlat boji, navbatdagi draftId orqali (hozircha kvitansiya yo'q → bo'sh).
  const draftIds = [...queueByKey.values()].map((v) => v.draftId).filter(Boolean) as string[];
  const feeByDraft = new Map<string, { receiptNumber: string | null; claimAmount: number | null }>();
  if (draftIds.length) {
    const fees = await prisma.courtFeeInvoice.findMany({ where: { draftId: { in: draftIds } }, select: { draftId: true, receiptNumber: true, claimAmount: true } });
    for (const f of fees) if (f.draftId) feeByDraft.set(f.draftId, { receiptNumber: f.receiptNumber, claimAmount: f.claimAmount == null ? null : Number(f.claimAmount) });
  }

  const linkOf = (l: (typeof loans)[number]) => {
    const key = keyOf(l.pinfl, l.branchCode);
    const qitem = key ? queueByKey.get(key) : undefined;
    const fee = qitem?.draftId ? feeByDraft.get(qitem.draftId) : undefined;
    const palata = key ? palataByKey.get(key) : undefined;
    return { stage: key ? caseByKey.get(key)?.stage : undefined, palata, queue: qitem, fee };
  };

  // ── Workbook ─────────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.creator = 'Yurist Tizimi';
  const C_TITLE = 'FF134E4A', C_HEAD = 'FF0F766E', C_SECT = 'FFD1EDE7', C_TOT = 'FFEEF2F6', C_BORDER = 'FFD1D5DB', C_ZEBRA = 'FFF7FAF9';
  const thin = { style: 'thin' as const, color: { argb: C_BORDER } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const colL = (nn: number) => { let s = ''; let n = nn; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const MONEY = '#,##0';

  const s1 = wb.addWorksheet(t('Sud roʻyxati'), { views: [{ state: 'frozen', ySplit: 4, xSplit: 1 }] });
  type Col = { key: string; w: number; h: string; g: string; money?: boolean; date?: boolean; center?: boolean; sum?: boolean };
  const G_PORT = t('PORTFEL KESIMI'), G_CLI = t('MIJOZ'), G_CON = t('SHARTNOMA'), G_DEBT = t('QARZDORLIK'), G_MARK = t('BELGILAR'), G_PAL = t('PALATA (imzolangan ariza)'), G_QUE = t('SUDGA YUBORISH NAVBATI'), G_FEE = t('DAVLAT BOJI');
  const COLS: Col[] = [
    { key: 'no', w: 5, h: '№', g: G_PORT, center: true },
    { key: 'sana', w: 12, h: t('Hisobot sanasi'), g: G_PORT, center: true },
    { key: 'mkoKod', w: 9, h: t('МКО коди'), g: G_PORT, center: true },
    { key: 'mko', w: 20, h: t('МКО'), g: G_PORT },
    { key: 'viloyat', w: 15, h: t('Viloyat'), g: G_PORT },
    { key: 'pinfl', w: 16, h: t('PINFL'), g: G_CLI },
    { key: 'fio', w: 28, h: t('F.I.O.'), g: G_CLI },
    { key: 'passport', w: 12, h: t('Passport'), g: G_CLI, center: true },
    { key: 'phone', w: 13, h: t('Telefon'), g: G_CLI },
    { key: 'addr', w: 30, h: t('Manzil'), g: G_CLI },
    { key: 'ld', w: 13, h: t('Shartnoma ID'), g: G_CON, center: true },
    { key: 'acc', w: 22, h: t('Ssuda hisobi'), g: G_CON },
    { key: 'summ', w: 15, h: t('Kredit summasi'), g: G_CON, money: true, sum: true },
    { key: 'rate', w: 8, h: t('Foiz stavkasi'), g: G_CON, center: true },
    { key: 'd1', w: 12, h: t('Ochilish sanasi'), g: G_CON, date: true },
    { key: 'd2', w: 12, h: t('Yopilish sanasi'), g: G_CON, date: true },
    { key: 'excl', w: 11, h: t('Sud roʻyxatida'), g: G_CON, center: true },
    { key: 'p', w: 15, h: t('Asosiy qarz'), g: G_DEBT, money: true, sum: true },
    { key: 'op', w: 15, h: t('Muddati oʻtgan asosiy'), g: G_DEBT, money: true, sum: true },
    { key: 'i', w: 13, h: t('Muddatli foiz'), g: G_DEBT, money: true, sum: true },
    { key: 'oi', w: 14, h: t('Muddati oʻtgan foiz'), g: G_DEBT, money: true, sum: true },
    { key: 'overdue', w: 16, h: t('Muddati oʻtgan qarz'), g: G_DEBT, money: true, sum: true },
    { key: 'total', w: 17, h: t('Jami qarz (МКО)'), g: G_DEBT, money: true, sum: true },
    { key: 'uniq', w: 10, h: t('Alohida mijoz'), g: G_MARK, center: true, sum: true },
    { key: 'closed', w: 11, h: t('Toʻliq yopilgan'), g: G_MARK, center: true, sum: true },
    { key: 'palReg', w: 13, h: t('Palata raqami'), g: G_PAL, center: true },
    { key: 'palPages', w: 9, h: t('Sahifalar'), g: G_PAL, center: true },
    { key: 'qState', w: 14, h: t('Navbat holati'), g: G_QUE, center: true },
    { key: 'qErr', w: 22, h: t('Navbat xatosi'), g: G_QUE },
    { key: 'feeReceipt', w: 16, h: t('Boji kvitansiyasi'), g: G_FEE, center: true },
    { key: 'feeClaim', w: 16, h: t('Daʼvo summasi'), g: G_FEE, money: true, sum: true },
  ];
  const NC = COLS.length, last = colL(NC);
  s1.columns = COLS.map((c) => ({ key: c.key, width: c.w }));

  // Sarlavha (1-2 qator)
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

  // Guruh sarlavhasi (3-qator) — birlashtirilgan
  const g3 = s1.getRow(3); g3.height = 18;
  for (let c = 1; c <= NC; c++) { const cell = g3.getCell(c); cell.fill = fill(C_TITLE); cell.border = box; }
  let gi = 1;
  while (gi <= NC) {
    const g = COLS[gi - 1].g; let span = 1;
    while (gi + span <= NC && COLS[gi + span - 1].g === g) span++;
    if (span > 1) s1.mergeCells(`${colL(gi)}3:${colL(gi + span - 1)}3`);
    const cell = g3.getCell(gi);
    cell.value = g;
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    gi += span;
  }

  // Ustun sarlavhasi (4-qator)
  const hr = s1.getRow(4); hr.height = 32;
  COLS.forEach((c, idx) => {
    const cell = hr.getCell(idx + 1);
    cell.value = c.h;
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(C_HEAD);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = box;
  });

  // Ma'lumot qatorlari (5-qatordan)
  const seenPinfl = new Set<string>();
  let i = 0;
  for (const l of loans) {
    const lk = linkOf(l);
    const overdue = num(l.debtOverduePrincipal) + num(l.debtOverdueInterest);
    const total = num(l.totalDebt);
    const firstPinfl = !!l.pinfl && !seenPinfl.has(l.pinfl); if (l.pinfl) seenPinfl.add(l.pinfl);
    s1.addRow({
      no: ++i,
      sana: snapLabel,
      mkoKod: l.branchCode ?? '',
      mko: firmByCode.get(l.branchCode ?? '') ?? l.branchCode ?? '',
      viloyat: region(l.regionName),
      pinfl: l.pinfl ?? '', fio: l.clientName ?? '', passport: l.passportSn ?? '', phone: l.phone ?? '', addr: l.postAddressUz || l.postAddress || '',
      ld: l.ldId ?? '', acc: l.account ?? '', summ: num(l.summKr), rate: num(l.rate),
      d1: l.dateToCr ?? null, d2: l.dateClose ?? null, excl: l.excluded ? t('Ha') : t('Yoʻq'),
      p: num(l.debtPrincipal), op: num(l.debtOverduePrincipal), i: num(l.debtTermInterest), oi: num(l.debtOverdueInterest),
      overdue, total,
      uniq: firstPinfl ? 1 : 0, closed: total === 0 ? 1 : 0,
      palReg: lk.palata?.reg ?? '', palPages: lk.palata?.pages ?? '',
      qState: lk.queue?.state ? t(QUEUE_LABEL_KEY[lk.queue.state] ?? lk.queue.state) : '',
      qErr: lk.queue?.lastError ?? '',
      feeReceipt: lk.fee?.receiptNumber ?? '', feeClaim: lk.fee?.claimAmount ?? null,
    });
  }
  const dataFrom = 5, dataTo = 4 + loans.length;
  COLS.forEach((c, idx) => {
    const col = s1.getColumn(idx + 1);
    if (c.money) col.numFmt = MONEY;
    if (c.date) col.numFmt = 'dd.mm.yyyy';
    if (c.center) col.alignment = { horizontal: 'center' };
  });

  // JAMI — jonli SUM
  if (loans.length) {
    const tr = s1.getRow(dataTo + 1); tr.height = 18;
    tr.getCell(2).value = t('JAMI');
    for (let cidx = 1; cidx <= NC; cidx++) {
      const cell = tr.getCell(cidx);
      cell.font = { bold: true }; cell.fill = fill(C_TOT);
      cell.border = { top: { style: 'medium', color: { argb: C_HEAD } }, bottom: thin, left: thin, right: thin };
      if (COLS[cidx - 1].sum) { cell.value = { formula: `SUM(${colL(cidx)}${dataFrom}:${colL(cidx)}${dataTo})` }; if (COLS[cidx - 1].money) cell.numFmt = MONEY; }
    }
  }
  s1.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: NC } };

  // ── Xulosa ───────────────────────────────────────────────────────────────────
  type Agg = { loans: number; clients: Set<string>; principal: number; overdue: number; total: number };
  const mk = (): Agg => ({ loans: 0, clients: new Set(), principal: 0, overdue: 0, total: 0 });
  const byFirm = new Map<string, Agg>(), byRegion = new Map<string, Agg>(), byKlass = new Map<string, Agg>();
  const all = mk();
  const submittedClients = new Set<string>();
  let palataCnt = 0, queueCnt = 0, feeCnt = 0, closedCnt = 0;
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
    if (num(l.totalDebt) === 0) closedCnt += 1;
    const lk = linkOf(l);
    if (lk.palata) palataCnt += 1;
    if (lk.queue) queueCnt += 1;
    if (lk.fee?.receiptNumber) feeCnt += 1;
    if (l.pinfl && lk.stage && SUBMITTED_STAGES.has(lk.stage)) submittedClients.add(l.pinfl);
  }

  const s2 = wb.addWorksheet(t('Xulosa'));
  s2.columns = [{ key: 'k', width: 34 }, { key: 'v', width: 16 }, { key: 'c', width: 14 }, { key: 'd', width: 20 }];
  s2.mergeCells('A1:D1');
  const x1 = s2.getCell('A1');
  x1.value = t('XULOSA').toUpperCase(); x1.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  x1.fill = fill(C_TITLE); x1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  s2.getRow(1).height = 24;

  const kpi = (k: string, v: string | number, money = false) => {
    const r = s2.addRow({ k, v });
    r.getCell(1).font = { bold: true }; r.getCell(1).border = box; r.getCell(1).fill = fill(C_SECT);
    const vc = r.getCell(2); vc.border = box; vc.alignment = { horizontal: 'right' }; if (money && typeof v === 'number') vc.numFmt = MONEY;
  };
  s2.addRow({});
  kpi(t('Snapshot (sana)'), snapLabel);
  kpi(t('Shartnomalar (kredit)'), all.loans);
  kpi(t('Mijozlar (kishi)'), all.clients.size);
  kpi(t('Toʻliq yopilgan (qarzi 0)'), closedCnt);
  kpi(t('Palata skani biriktirilgan'), palataCnt);
  kpi(t('Sudga yuborish navbatida'), queueCnt);
  kpi(t('Boji kvitansiyasi bor'), feeCnt);
  kpi(t('Sudga chiqarilgan (mijoz)'), submittedClients.size);
  kpi(t('Asosiy qarz'), all.principal, true);
  kpi(t('Muddati oʻtgan jami'), all.overdue, true);
  kpi(t('Jami qarz (МКО)'), all.total, true);

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
    const tot = [...m.values()].reduce((x, a) => ({ l: x.l + a.loans, tt: x.tt + a.total }), { l: 0, tt: 0 });
    const tr = s2.addRow({ k: t('JAMI'), v: tot.l, d: tot.tt });
    [1, 2, 3, 4].forEach((n) => { const cl = tr.getCell(n); cl.font = { bold: true }; cl.fill = fill(C_TOT); cl.border = box; if (n > 1) cl.alignment = { horizontal: 'right' }; });
    tr.getCell(4).numFmt = MONEY;
  };
  table(t('Firma boʻyicha'), byFirm);
  table(t('Viloyat boʻyicha'), byRegion);
  table(t('Klassifikatsiya boʻyicha'), byKlass);

  // ── PINFL boʻyicha (kishi darajasida agregatsiya) ───────────────────────────
  // Har kishiga bir qator: firma(lar), kreditlar soni, jami qarz, asosiy, muddati oʻtgan,
  // palata skani, sudga yuborish holati. Ohirida — firma boʻyicha rollup (soni + summa).
  type PAgg = {
    pinfl: string; fio: string; passport: string; phone: string; addr: string; region: string;
    firms: Set<string>; loans: number; principal: number; overdueSum: number; total: number;
    palata: boolean; queueStates: Set<string>; closedFully: boolean; anyClosed: number;
    firmIds: Set<number>;
  };
  const byPinfl = new Map<string, PAgg>();
  for (const l of loans) {
    if (!l.pinfl) continue;
    let a = byPinfl.get(l.pinfl);
    if (!a) {
      a = { pinfl: l.pinfl, fio: l.clientName ?? '', passport: l.passportSn ?? '', phone: l.phone ?? '',
        addr: l.postAddressUz || l.postAddress || '', region: region(l.regionName),
        firms: new Set(), loans: 0, principal: 0, overdueSum: 0, total: 0,
        palata: false, queueStates: new Set(), closedFully: true, anyClosed: 0, firmIds: new Set() };
      byPinfl.set(l.pinfl, a);
    }
    const firmName = firmByCode.get(l.branchCode ?? '') ?? l.branchCode ?? '—';
    a.firms.add(firmName);
    const fid = firmIdByCode.get(l.branchCode ?? '');
    if (fid) a.firmIds.add(fid);
    a.loans += 1;
    a.principal += num(l.debtPrincipal);
    a.overdueSum += num(l.debtOverduePrincipal) + num(l.debtOverdueInterest);
    a.total += num(l.totalDebt);
    if (num(l.totalDebt) > 0) a.closedFully = false;
    if (num(l.totalDebt) === 0) a.anyClosed += 1;
    const lk = linkOf(l);
    if (lk.palata) a.palata = true;
    if (lk.queue?.state) a.queueStates.add(t(QUEUE_LABEL_KEY[lk.queue.state] ?? lk.queue.state));
  }

  const s3 = wb.addWorksheet(t('PINFL boʻyicha'), { views: [{ state: 'frozen', ySplit: 3, xSplit: 2 }] });
  type PCol = { key: string; w: number; h: string; money?: boolean; center?: boolean; sum?: boolean };
  const PCOLS: PCol[] = [
    { key: 'no',       w: 5,  h: '№',                center: true },
    { key: 'pinfl',    w: 16, h: t('PINFL') },
    { key: 'fio',      w: 30, h: t('F.I.O.') },
    { key: 'firms',    w: 22, h: t('Firma(lar)') },
    { key: 'firmCnt',  w: 10, h: t('Firmalar soni'), center: true, sum: true },
    { key: 'loans',    w: 12, h: t('Kreditlar soni'), center: true, sum: true },
    { key: 'principal',w: 15, h: t('Asosiy qarz'),   money: true, sum: true },
    { key: 'overdue',  w: 16, h: t('Muddati oʻtgan qarz'), money: true, sum: true },
    { key: 'total',    w: 17, h: t('Jami qarz (МКО)'), money: true, sum: true },
    { key: 'closed',   w: 12, h: t('Yopiq kreditlar'), center: true, sum: true },
    { key: 'passport', w: 12, h: t('Passport'),      center: true },
    { key: 'phone',    w: 13, h: t('Telefon') },
    { key: 'region',   w: 15, h: t('Viloyat') },
    { key: 'addr',     w: 30, h: t('Manzil') },
    { key: 'palata',   w: 10, h: t('Palata skani'),   center: true },
    { key: 'queue',    w: 20, h: t('Navbat holati'),  center: true },
  ];
  const PNC = PCOLS.length, pLast = colL(PNC);
  s3.columns = PCOLS.map((c) => ({ key: c.key, width: c.w }));

  // Sarlavha 1-2 qator
  s3.mergeCells(`A1:${pLast}1`);
  const p3t = s3.getCell('A1');
  p3t.value = t('PINFL BOʻYICHA (kishi darajasida)').toUpperCase();
  p3t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  p3t.fill = fill(C_TITLE); p3t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  s3.getRow(1).height = 26;
  s3.mergeCells(`A2:${pLast}2`);
  const p3s = s3.getCell('A2');
  p3s.value = `${t('Snapshot')}: ${snapLabel}   ·   ${t('Kishilar')}: ${byPinfl.size.toLocaleString('ru-RU')}   ·   ${t('Shartnomalar')}: ${loans.length.toLocaleString('ru-RU')}`;
  p3s.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
  p3s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  s3.getRow(2).height = 16;

  const p3h = s3.getRow(3); p3h.height = 30;
  PCOLS.forEach((c, idx) => {
    const cell = p3h.getCell(idx + 1);
    cell.value = c.h; cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(C_HEAD); cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = box;
  });

  // Kishilar jami qarz kamayish tartibida
  const persons = [...byPinfl.values()].sort((a, b) => b.total - a.total || b.loans - a.loans);
  let pi = 0;
  for (const p of persons) {
    s3.addRow({
      no: ++pi,
      pinfl: p.pinfl, fio: p.fio,
      firms: [...p.firms].sort().join(', '),
      firmCnt: p.firms.size, loans: p.loans,
      principal: p.principal, overdue: p.overdueSum, total: p.total,
      closed: p.anyClosed,
      passport: p.passport, phone: p.phone, region: p.region, addr: p.addr,
      palata: p.palata ? t('Ha') : t('Yoʻq'),
      queue: [...p.queueStates].join(', '),
    });
  }
  const pDataFrom = 4, pDataTo = 3 + persons.length;
  PCOLS.forEach((c, idx) => {
    const col = s3.getColumn(idx + 1);
    if (c.money) col.numFmt = MONEY;
    if (c.center) col.alignment = { horizontal: 'center' };
  });
  if (persons.length) {
    const tr = s3.getRow(pDataTo + 1); tr.height = 18;
    tr.getCell(3).value = t('JAMI');
    for (let cidx = 1; cidx <= PNC; cidx++) {
      const cell = tr.getCell(cidx);
      cell.font = { bold: true }; cell.fill = fill(C_TOT);
      cell.border = { top: { style: 'medium', color: { argb: C_HEAD } }, bottom: thin, left: thin, right: thin };
      if (PCOLS[cidx - 1].sum) { cell.value = { formula: `SUM(${colL(cidx)}${pDataFrom}:${colL(cidx)}${pDataTo})` }; if (PCOLS[cidx - 1].money) cell.numFmt = MONEY; }
    }
  }
  s3.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: PNC } };

  // Firma bo'yicha rollup (kishi + kreditlar + summa) — pastida
  const firmRollup = new Map<string, { persons: Set<string>; loans: number; principal: number; overdue: number; total: number }>();
  for (const p of persons) {
    for (const fn of p.firms) {
      let r = firmRollup.get(fn);
      if (!r) { r = { persons: new Set(), loans: 0, principal: 0, overdue: 0, total: 0 }; firmRollup.set(fn, r); }
      r.persons.add(p.pinfl);
    }
  }
  // Firma boʻyicha loanCount/summa loanning haqiqiy branchCode'i orqali (mijozning boshqa firmadagi kreditini takrorlamaslik uchun)
  for (const l of loans) {
    if (!l.pinfl) continue;
    const fn = firmByCode.get(l.branchCode ?? '') ?? l.branchCode ?? '—';
    const r = firmRollup.get(fn);
    if (!r) continue;
    r.loans += 1;
    r.principal += num(l.debtPrincipal);
    r.overdue += num(l.debtOverduePrincipal) + num(l.debtOverdueInterest);
    r.total += num(l.totalDebt);
  }

  // Bo'sh qator + firma rollup sarlavha
  s3.addRow({}); s3.addRow({});
  const secR = s3.addRow({ no: '', pinfl: t('FIRMA BOʻYICHA JAMLASH (kishi + kredit + summa)') });
  s3.mergeCells(`B${secR.number}:${pLast}${secR.number}`);
  secR.getCell(2).font = { bold: true, size: 12, color: { argb: C_TITLE } };
  secR.getCell(2).fill = fill(C_SECT); secR.getCell(2).alignment = { indent: 1 };

  const hR = s3.addRow({ no: '', pinfl: t('Firma'), fio: t('Kishilar'), firms: t('Kreditlar'), firmCnt: '', loans: '', principal: t('Asosiy qarz'), overdue: t('Muddati oʻtgan'), total: t('Jami qarz') });
  ;[2, 3, 4, 7, 8, 9].forEach((n) => { const cl = hR.getCell(n); cl.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cl.fill = fill(C_HEAD); cl.border = box; cl.alignment = { horizontal: n === 2 ? 'left' : 'right' }; });

  const firmRows = [...firmRollup.entries()].sort((a, b) => b[1].total - a[1].total);
  let zebra = false;
  for (const [fn, r] of firmRows) {
    const row = s3.addRow({ no: '', pinfl: fn, fio: r.persons.size, firms: r.loans, principal: r.principal, overdue: r.overdue, total: r.total });
    zebra = !zebra;
    ;[2, 3, 4, 7, 8, 9].forEach((n) => { const cl = row.getCell(n); cl.border = box; if (n > 2) cl.alignment = { horizontal: 'right' }; if (zebra) cl.fill = fill(C_ZEBRA); });
    row.getCell(7).numFmt = MONEY;
    row.getCell(8).numFmt = MONEY;
    row.getCell(9).numFmt = MONEY;
  }
  const gtot = [...firmRollup.values()].reduce((x, a) => ({ p: x.p + a.persons.size, l: x.l + a.loans, pr: x.pr + a.principal, ov: x.ov + a.overdue, tt: x.tt + a.total }), { p: 0, l: 0, pr: 0, ov: 0, tt: 0 });
  const gtR = s3.addRow({ no: '', pinfl: t('JAMI'), fio: byPinfl.size, firms: loans.length, principal: gtot.pr, overdue: gtot.ov, total: gtot.tt });
  ;[2, 3, 4, 7, 8, 9].forEach((n) => { const cl = gtR.getCell(n); cl.font = { bold: true }; cl.fill = fill(C_TOT); cl.border = box; if (n > 2) cl.alignment = { horizontal: 'right' }; });
  gtR.getCell(7).numFmt = MONEY; gtR.getCell(8).numFmt = MONEY; gtR.getCell(9).numFmt = MONEY;

  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  // Fayl nomida BUGUNGI sana (yuklab olingan sana) — snapshot sanasi emas (u ichida yozilgan).
  const today = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;
  const name = `${t('Sud formasi').replace(/\s+/g, '_')}_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}
