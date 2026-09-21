// 4 firma bo'yicha «Kirgan ishlar» spiska — har firmaga BITTA Excel, 2 tab:
//   Tab 1 «Kirgan ishlar» — sudga kirgan (ClientCaseStatus source=CABINET) HAR ISH
//     bo'yicha bir qator: ish raqami, kategoriya, sud/sudya, holat/natija, sanalar,
//     ijro raqami, ijrochi, kvitansiya/boji va biz sudga yuborgan sana.
//   Tab 2 «PINFL ro'yxati» — o'sha spiska'dagi UNIKAL PINFL (F.I.O bilan) va har
//     odam bo'yicha ishlar soni.
//
// Chiqish: exports/spiska/<firm>_spiska_YYYY-MM-DD.xlsx (4 fayl).
//
//   npx tsx scripts/spiska-firms-export.ts [firm-code=...]        # bir/keyin firma
//   npx tsx scripts/spiska-firms-export.ts                        # 4 firma barcha
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { prisma } from '../src/lib/db';
import { FIRMS } from '../src/lib/firms';
import { classifyStatus } from '../src/lib/court-ready';

const OUT = path.join(process.cwd(), 'exports', 'spiska');
const toISO = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const digits = (s: any) => String(s ?? '').replace(/\D+/g, '');

interface Row {
  pinfl: string; pinflSource: string; clientName: string;
  caseNumber: string; category: string; claimKind: string;
  courtName: string; judge: string;
  statusLabel: string; statusCode: string; caseResult: string;
  defAddress: string; defPassport: string;
  registryDt: string; hearingDate: string;
  ijroNumber: string; executor: string; executorDept: string;
  invoiceNo: string; receiptNumber: string;
  courtSentAt: string; updatedAt: string;
}

// ADOLAT PINFL manbasi. Sud ro'yxatida FAQAT ISM keladi — PINFL ikki yo'l bilan qo'shiladi:
//   PINFL — detal so'rovidan (get-one-case-by-id) davlat reyestridagi haqiqiy javobgar PINFL'i;
//   NAME  — sud faqat ismni berdi, biz normName bo'yicha o'z portfeldan topdik (ehtimol);
//   UNMATCHED — sud ismini portfelda topolmadi yoki noaniq (bir xil ismli 2 mijoz).
const MATCH_UZ: Record<string, string> = {
  PINFL: 'Sud (aniq)', NAME: 'Portfel (ism bo‘yicha)', UNMATCHED: '—',
  CLAIM_ID: 'Sud (claim id)', CUSTOM_ID: 'Sud (custom id)',
};

const CAT_UZ: Record<string, string> = {
  civil: 'Fuqarolik', economic: 'Iqtisodiy', administrative: 'Ma’muriy', conflict: 'Nizoli',
};
const KIND_UZ: Record<string, string> = { DECREE: 'Sud buyrug‘i', SUIT: 'Da’vo', MATERIAL: 'Material' };

async function collect(firmCode: string, firmName: string): Promise<Row[]> {
  const firm = await prisma.firm.findUnique({ where: { code: firmCode }, select: { id: true } });
  if (!firm) return [];

  // FAQAT SUDDAN ANIQ PINFL. Ism bo'yicha portfel-taxminlar (matchedBy='NAME') va
  // topilmaganlar (UNMATCHED) EKSPORTGA TUSHMAYDI — noto'g'ri odam bilan ishlash xavfli.
  // Sud detal so'rovi hali yetmagan bo'lsa, o'sha ish keyingi eksportda paydo bo'ladi.
  const statuses = await prisma.clientCaseStatus.findMany({
    where: { branchCode: firmCode, source: 'CABINET', matchedBy: 'PINFL', pinfl: { not: null } },
    orderBy: [{ registryDt: 'desc' }, { updatedAt: 'desc' }],
  });
  if (!statuses.length) return [];

  const pinfls = [...new Set(statuses.map((s) => s.pinfl).filter((x): x is string => !!x))];

  // 2) MibCase: pinfl bo'yicha ijro raqami. MibClient orqali.
  const mibClients = pinfls.length
    ? await prisma.mibClient.findMany({
        where: { pinfl: { in: pinfls } },
        orderBy: { checkedAt: 'desc' },
        select: { id: true, pinfl: true, fio: true, fio2: true, cases: { orderBy: { id: 'desc' }, select: { workNumber: true, executorName: true, executorDept: true } } },
      })
    : [];
  const mibByPinfl = new Map<string, { ijro: string; executor: string; dept: string }>();
  for (const mc of mibClients) {
    if (!mc.pinfl) continue;
    if (mibByPinfl.has(mc.pinfl)) continue;
    const c = mc.cases[0];
    if (c?.workNumber) mibByPinfl.set(mc.pinfl, { ijro: c.workNumber, executor: c.executorName ?? '', dept: c.executorDept ?? '' });
  }

  // 3) ArizaCase (bizning ichki holat): kvitansiya, boji, courtSentAt
  const arizas = pinfls.length
    ? await prisma.arizaCase.findMany({
        where: { firmId: firm.id, pinfl: { in: pinfls } },
        orderBy: [{ courtSentAt: 'desc' }, { updatedAt: 'desc' }],
        select: { pinfl: true, invoiceNo: true, receiptNumber: true, courtSentAt: true, court: { select: { shortName: true } } },
      })
    : [];
  const arizaByPinfl = new Map<string, { invoiceNo: string; receiptNumber: string; courtSentAt: Date | null; courtName: string }>();
  for (const a of arizas) {
    if (!a.pinfl) continue;
    if (arizaByPinfl.has(a.pinfl)) continue;
    arizaByPinfl.set(a.pinfl, {
      invoiceNo: a.invoiceNo ?? '',
      receiptNumber: a.receiptNumber ?? '',
      courtSentAt: a.courtSentAt ?? null,
      courtName: a.court?.shortName ?? '',
    });
  }

  // 4) Court name — courtId (billingCourtId) bo'yicha
  const cIds = [...new Set(statuses.map((s) => s.courtId).filter((x): x is string => !!x))];
  const courts = cIds.length
    ? await prisma.court.findMany({ where: { billingCourtId: { in: cIds } }, select: { billingCourtId: true, shortName: true, nameUz: true } })
    : [];
  const courtByBid = new Map(courts.map((c) => [c.billingCourtId, c.shortName || c.nameUz || '']));

  const rows: Row[] = statuses.map((s) => {
    const cls = classifyStatus('CABINET', { status: s.status, statusLabel: s.statusLabel, caseResult: s.caseResult });
    const ari = s.pinfl ? arizaByPinfl.get(s.pinfl) : undefined;
    const mib = s.pinfl ? mibByPinfl.get(s.pinfl) : undefined;
    const cName = (s.courtId && courtByBid.get(s.courtId)) || ari?.courtName || '';
    return {
      pinfl: s.pinfl ?? '',
      pinflSource: MATCH_UZ[String(s.matchedBy ?? '').toUpperCase()] ?? (s.matchedBy ?? ''),
      clientName: s.clientName ?? '',
      caseNumber: s.caseNumber ?? '',
      category: CAT_UZ[String(s.category ?? '').toLowerCase()] ?? (s.category ?? ''),
      claimKind: KIND_UZ[String(s.claimKind ?? '').toUpperCase()] ?? (s.claimKind ?? ''),
      courtName: cName,
      judge: s.judge ?? '',
      statusLabel: cls.label,
      statusCode: cls.code,
      caseResult: s.caseResult ?? '',
      defAddress: s.defAddress ?? '',
      defPassport: s.defPassport ?? '',
      registryDt: toISO(s.registryDt),
      hearingDate: toISO(s.hearingDate),
      ijroNumber: mib?.ijro ?? '',
      executor: mib?.executor ?? '',
      executorDept: mib?.dept ?? '',
      invoiceNo: ari?.invoiceNo ?? '',
      receiptNumber: ari?.receiptNumber ?? '',
      courtSentAt: toISO(ari?.courtSentAt ?? null),
      updatedAt: toISO(s.updatedAt),
    };
  });
  return rows;
}

function buildWorkbook(firmName: string, rows: Row[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'docsystem';
  wb.created = new Date(0); // deterministik

  // Tab 1: Kirgan ishlar
  const ws1 = wb.addWorksheet('Kirgan ishlar', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = [
    { header: '№', key: 'no', width: 6 },
    { header: 'PINFL', key: 'pinfl', width: 16 },
    { header: 'PINFL manbasi', key: 'pinflSource', width: 20 },
    { header: 'F.I.O', key: 'clientName', width: 34 },
    { header: 'Ish raqami', key: 'caseNumber', width: 18 },
    { header: 'Tur', key: 'claimKind', width: 12 },
    { header: 'Kategoriya', key: 'category', width: 12 },
    { header: 'Sud', key: 'courtName', width: 26 },
    { header: 'Sudya', key: 'judge', width: 26 },
    { header: 'Holat', key: 'statusLabel', width: 20 },
    { header: 'Natija (raw)', key: 'caseResult', width: 16 },
    { header: 'Ro‘yxatga olingan', key: 'registryDt', width: 14 },
    { header: 'Sud yig‘ilishi', key: 'hearingDate', width: 14 },
    { header: 'Manzil', key: 'defAddress', width: 34 },
    { header: 'Pasport', key: 'defPassport', width: 14 },
    { header: 'Ijro raqami', key: 'ijroNumber', width: 22 },
    { header: 'Ijrochi', key: 'executor', width: 22 },
    { header: 'Ijro organi', key: 'executorDept', width: 28 },
    { header: 'Kvitansiya №', key: 'receiptNumber', width: 20 },
    { header: 'Boji invoice №', key: 'invoiceNo', width: 20 },
    { header: 'Sudga jo‘natilgan', key: 'courtSentAt', width: 14 },
    { header: 'Yangilangan', key: 'updatedAt', width: 12 },
  ];
  ws1.columns = cols;
  ws1.getRow(1).font = { bold: true };
  ws1.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  ws1.getRow(1).height = 28;
  ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF7' } };

  // PINFL/raqamli ustunlar TEXT (Excel «katta raqam»ni ilmiy formatga aylantirmasin)
  const textCols = ['pinfl', 'caseNumber', 'ijroNumber', 'receiptNumber', 'invoiceNo', 'defPassport'];
  for (const key of textCols) { const c = ws1.getColumn(key); c.numFmt = '@'; }

  // Holat bo'yicha ranglash
  const TONE: Record<string, string> = {
    SATISFIED: 'FFDFF7E4', FINISHED: 'FFDFF7E4', PARTIAL: 'FFFFF3CD',
    DECLINED: 'FFFCE1E1', RETURNED: 'FFFCE1E1', UNCONSIDERED: 'FFEEEEEE',
    WITHDRAWN: 'FFEEEEEE', DECIDED: 'FFEEE4FA',
    IN_PROCESS: 'FFE1F0FF', PENDING: 'FFFFF3CD', CREATED: 'FFEAF6FE',
  };
  rows.forEach((r, i) => {
    const rr = ws1.addRow({ no: i + 1, ...r });
    const bg = TONE[r.statusCode];
    if (bg) rr.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } } as any;
    });
    rr.alignment = { vertical: 'middle', wrapText: false };
  });
  ws1.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  // Tab 2: PINFL ro'yxati (unikal)
  const ws2 = wb.addWorksheet('PINFL ro‘yxati', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws2.columns = [
    { header: '№', key: 'no', width: 6 },
    { header: 'PINFL', key: 'pinfl', width: 18 },
    { header: 'F.I.O', key: 'clientName', width: 40 },
    { header: 'Kirgan ishlar soni', key: 'count', width: 20 },
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF7' } };
  ws2.getColumn('pinfl').numFmt = '@';
  const byPinfl = new Map<string, { name: string; count: number }>();
  for (const r of rows) {
    const key = r.pinfl || `_no_pinfl:${r.clientName}`;
    const prev = byPinfl.get(key);
    if (prev) prev.count += 1;
    else byPinfl.set(key, { name: r.clientName, count: 1 });
  }
  const uniq = [...byPinfl.entries()]
    .map(([p, v]) => ({ pinfl: p.startsWith('_no_pinfl:') ? '' : p, clientName: v.name, count: v.count }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName));
  uniq.forEach((r, i) => ws2.addRow({ no: i + 1, ...r }));
  ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };

  return wb;
}

async function main() {
  const args = process.argv.slice(2);
  const onlyFirm = args.find((a) => /^\d{4,6}$/.test(a));
  const firms = onlyFirm ? FIRMS.filter((f) => f.branchCode === onlyFirm) : FIRMS;
  if (!firms.length) { console.error('Firma topilmadi:', onlyFirm); process.exit(1); }

  await fs.mkdir(OUT, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);

  const summary: { firm: string; code: string; cases: number; pinfls: number; file: string }[] = [];
  for (const f of firms) {
    console.log(`\n== ${f.name} (${f.branchCode}) ==`);
    const rows = await collect(f.branchCode, f.name);
    const uniq = new Set(rows.map((r) => r.pinfl).filter(Boolean));
    console.log(`  kirgan ishlar: ${rows.length} · unikal PINFL: ${uniq.size}`);
    const wb = buildWorkbook(f.name, rows);
    const short = f.name.split(/\s+/)[0]; // BRIGHT/URBAN/COMMUNITY/FUNDFLOW
    const file = path.join(OUT, `${short}_spiska_${today}.xlsx`);
    await wb.xlsx.writeFile(file);
    summary.push({ firm: f.name, code: f.branchCode, cases: rows.length, pinfls: uniq.size, file });
    console.log(`  ✓ ${file}`);
  }

  console.log('\n===== Xulosa =====');
  for (const s of summary) console.log(`${s.code} ${s.firm.padEnd(28)}  ${String(s.cases).padStart(6)} ish  ${String(s.pinfls).padStart(5)} PINFL  →  ${path.relative(process.cwd(), s.file)}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error('✗', e instanceof Error ? e.stack || e.message : e); process.exit(1); });
