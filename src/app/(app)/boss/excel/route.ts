import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import ExcelJS from 'exceljs';
import { requireAccess } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { bossReport, type BossReportData } from '@/lib/boss-report';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// ── Boshliq hisoboti Excel — stilizatsiyalangan (Sud formasi bilan bir palitrada) ───────────────
function buildBossExcel(d: BossReportData, snapLabel: string, t: ReturnType<typeof getT>): Buffer | Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.creator = 'Yurist Tizimi';
  const C_TITLE = 'FF134E4A', C_HEAD = 'FF0F766E', C_SECT = 'FFD1EDE7', C_TOT = 'FFEEF2F6', C_BORDER = 'FFD1D5DB', C_ZEBRA = 'FFF7FAF9';
  const thin = { style: 'thin' as const, color: { argb: C_BORDER } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const colL = (nn: number) => { let s = ''; let n = nn; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const MONEY = '#,##0';
  const tt = d.totals;
  const now = new Date(); const p2 = (n: number) => String(n).padStart(2, '0');
  const genStamp = `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`;

  // Har varaqning tepasidagi 2 qatorli sarlavhani bir joydan qo'yamiz (izchillik + tez).
  type HdrDef = { title: string; subtitle: string; span: number };
  const setHeader = (ws: ExcelJS.Worksheet, h: HdrDef) => {
    const last = colL(h.span);
    ws.mergeCells(`A1:${last}1`);
    const t1 = ws.getCell('A1');
    t1.value = h.title.toUpperCase();
    t1.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    t1.fill = fill(C_TITLE); t1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 24;
    ws.mergeCells(`A2:${last}2`);
    const t2 = ws.getCell('A2');
    t2.value = h.subtitle;
    t2.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
    t2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(2).height = 16;
  };
  // Ustun sarlavhalarini rasmiylashtirish + JAMI qatori.
  const styleHead = (ws: ExcelJS.Worksheet, row: number, span: number) => {
    const r = ws.getRow(row); r.height = 26;
    for (let c = 1; c <= span; c++) {
      const cell = r.getCell(c);
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = fill(C_HEAD);
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = box;
    }
  };
  const zebra = (ws: ExcelJS.Worksheet, from: number, to: number, span: number) => {
    for (let r = from; r <= to; r++) {
      const row = ws.getRow(r); row.height = 16;
      for (let c = 1; c <= span; c++) {
        const cell = row.getCell(c);
        cell.border = box;
        if ((r - from) % 2 === 1 && !cell.fill) cell.fill = fill(C_ZEBRA);
      }
    }
  };
  const totalRow = (ws: ExcelJS.Worksheet, row: number, span: number, label: string, labelCol = 1) => {
    const r = ws.getRow(row); r.height = 18;
    for (let c = 1; c <= span; c++) {
      const cell = r.getCell(c);
      cell.font = { bold: true }; cell.fill = fill(C_TOT);
      cell.border = { top: { style: 'medium', color: { argb: C_HEAD } }, bottom: thin, left: thin, right: thin };
    }
    r.getCell(labelCol).value = label;
  };
  const subtitleBase = `${t('Snapshot')}: ${snapLabel}   ·   ${t('Yuklab olingan')}: ${genStamp}   ·   ${d.firms.length} ${t('firma')}   ·   ${tt.clients.toLocaleString('ru-RU')} ${t('mijoz')}   ·   ${tt.debt.toLocaleString('ru-RU')} ${t('soʻm')}`;

  // ── 1) Firmalar (matritsa) ─────────────────────────────────────────────────
  const s1 = wb.addWorksheet(t('Firmalar'), { views: [{ state: 'frozen', ySplit: 3, xSplit: 1 }] });
  const S1_COLS = [
    { header: t('Firma'), key: 'firma', width: 30 },
    { header: t('Mijozlar'), key: 'cli', width: 11, num: true },
    { header: t('Talabnoma'), key: 'tal', width: 12, num: true },
    { header: t('Sanoat palatasi (skan)'), key: 'san', width: 15, num: true },
    { header: t('Sud: koʻrib chiqishda'), key: 'sr', width: 16, num: true },
    { header: t('Sud: qanoatlantirilgan'), key: 'sg', width: 18, num: true },
    { header: t('Sud: qaytarilgan'), key: 'sret', width: 14, num: true },
    { header: t('Sud: rad qilingan'), key: 'srej', width: 13, num: true },
    { header: t('Sudga jami'), key: 'sjami', width: 12, num: true, bold: true },
    { header: t('MIBga'), key: 'mib', width: 10, num: true },
    { header: t('Jami qarz'), key: 'debt', width: 18, money: true },
  ];
  s1.columns = S1_COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  setHeader(s1, { title: t('Firmalar boʻyicha oqim'), subtitle: subtitleBase, span: S1_COLS.length });
  // ExcelJS `columns` bilan header 1-qatorga qo'yiladi — biz uni 3-qatorga ko'chiramiz.
  s1.spliceRows(1, 0); s1.spliceRows(1, 0);
  const s1Head = s1.getRow(3);
  S1_COLS.forEach((c, i) => { s1Head.getCell(i + 1).value = c.header; });
  styleHead(s1, 3, S1_COLS.length);
  for (const f of d.firms) s1.addRow({ firma: f.firmName, cli: f.clients, tal: f.talabnoma, san: f.sanoat, sr: f.sud.inReview, sg: f.sud.granted, sret: f.sud.returned, srej: f.sud.rejected, sjami: f.sud.total, mib: f.mib, debt: f.debt });
  const s1From = 4, s1To = 3 + d.firms.length;
  zebra(s1, s1From, s1To, S1_COLS.length);
  S1_COLS.forEach((c, i) => {
    const col = s1.getColumn(i + 1);
    if (c.money) col.numFmt = MONEY; else if (c.num) col.numFmt = '#,##0';
    col.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
  });
  // JAMI
  s1.addRow({ firma: t('JAMI'), cli: tt.clients, tal: tt.talabnoma, san: tt.sanoat, sr: tt.sud.inReview, sg: tt.sud.granted, sret: tt.sud.returned, srej: tt.sud.rejected, sjami: tt.sud.total, mib: tt.mib, debt: tt.debt });
  totalRow(s1, s1To + 1, S1_COLS.length, t('JAMI'));
  s1.getRow(s1To + 1).getCell(S1_COLS.length).numFmt = MONEY;
  s1.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: S1_COLS.length } };

  // ── 2) Sud statuslari ──────────────────────────────────────────────────────
  const s2 = wb.addWorksheet(t('Sud statuslari'), { views: [{ state: 'frozen', ySplit: 3, xSplit: 1 }] });
  const S2_COLS = [
    { header: t('Firma'), key: 'firma', width: 30 },
    { header: t('Koʻrib chiqishda'), key: 'sr', width: 16, num: true, tone: 'FFDBEAFE' },
    { header: t('Qanoatlantirilgan'), key: 'sg', width: 18, num: true, tone: 'FFDCFCE7' },
    { header: t('Qaytarilgan'), key: 'sret', width: 14, num: true, tone: 'FFFEE2E2' },
    { header: t('Rad qilingan'), key: 'srej', width: 14, num: true, tone: 'FFFEE2E2' },
    { header: t('Jami'), key: 'sjami', width: 10, num: true, bold: true },
  ];
  s2.columns = S2_COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  setHeader(s2, { title: t('Sud statuslari (firma boʻyicha)'), subtitle: subtitleBase, span: S2_COLS.length });
  s2.spliceRows(1, 0); s2.spliceRows(1, 0);
  const s2Head = s2.getRow(3);
  S2_COLS.forEach((c, i) => { s2Head.getCell(i + 1).value = c.header; if (c.tone) s2Head.getCell(i + 1).fill = fill(c.tone); });
  styleHead(s2, 3, S2_COLS.length);
  // Toifa toning'i header'da — restore
  S2_COLS.forEach((c, i) => { if (c.tone) { const cell = s2.getRow(3).getCell(i + 1); cell.fill = fill(C_HEAD); } });
  for (const f of d.firms) s2.addRow({ firma: f.firmName, sr: f.sud.inReview, sg: f.sud.granted, sret: f.sud.returned, srej: f.sud.rejected, sjami: f.sud.total });
  const s2From = 4, s2To = 3 + d.firms.length;
  zebra(s2, s2From, s2To, S2_COLS.length);
  S2_COLS.forEach((c, i) => {
    const col = s2.getColumn(i + 1);
    if (c.num) col.numFmt = '#,##0';
    col.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
  });
  s2.addRow({ firma: t('JAMI'), sr: tt.sud.inReview, sg: tt.sud.granted, sret: tt.sud.returned, srej: tt.sud.rejected, sjami: tt.sud.total });
  totalRow(s2, s2To + 1, S2_COLS.length, t('JAMI'));

  // ── 3) Bosqichlar (funnel) ─────────────────────────────────────────────────
  const s3 = wb.addWorksheet(t('Bosqichlar'), { views: [{ state: 'frozen', ySplit: 3 }] });
  s3.columns = [{ header: t('Bosqich'), key: 'step', width: 36 }, { header: t('Soni'), key: 'val', width: 16 }];
  setHeader(s3, { title: t('Bosqichlar (funnel)'), subtitle: subtitleBase, span: 2 });
  s3.spliceRows(1, 0); s3.spliceRows(1, 0);
  s3.getRow(3).getCell(1).value = t('Bosqich'); s3.getRow(3).getCell(2).value = t('Soni');
  styleHead(s3, 3, 2);
  const funnel: [string, number, boolean][] = [
    [`1. ${t('Talabnoma')}`, tt.talabnoma, true],
    [`2. ${t('Sanoat palatasi')}`, tt.sanoat, true],
    [`3. ${t('Sudga chiqarilgan (jami)')}`, tt.sud.total, true],
    [`   — ${t('koʻrib chiqishda')}`, tt.sud.inReview, false],
    [`   — ${t('qanoatlantirilgan')}`, tt.sud.granted, false],
    [`   — ${t('qaytarilgan')}`, tt.sud.returned, false],
    [`   — ${t('rad qilingan')}`, tt.sud.rejected, false],
    [`4. ${t('MIBga chiqarilgan')}`, tt.mib, true],
  ];
  for (const [step, val] of funnel) s3.addRow({ step, val });
  const s3From = 4, s3To = 3 + funnel.length;
  zebra(s3, s3From, s3To, 2);
  s3.getColumn(2).numFmt = '#,##0';
  s3.getColumn(1).alignment = { vertical: 'middle' };
  s3.getColumn(2).alignment = { horizontal: 'right', vertical: 'middle' };
  funnel.forEach(([, , bold], i) => { if (bold) s3.getRow(s3From + i).font = { bold: true }; });

  // ── 4) Umumiy KPI ──────────────────────────────────────────────────────────
  const s4 = wb.addWorksheet(t('Umumiy'), { views: [{ state: 'frozen', ySplit: 3 }] });
  s4.columns = [{ header: t('Koʻrsatkich'), key: 'k', width: 34 }, { header: t('Qiymat'), key: 'v', width: 24 }];
  setHeader(s4, { title: t('Umumiy koʻrsatkichlar'), subtitle: subtitleBase, span: 2 });
  s4.spliceRows(1, 0); s4.spliceRows(1, 0);
  s4.getRow(3).getCell(1).value = t('Koʻrsatkich'); s4.getRow(3).getCell(2).value = t('Qiymat');
  styleHead(s4, 3, 2);
  const kpis: [string, string | number, boolean][] = [
    [t('Snapshot (sana)'), snapLabel, false],
    [t('Yuklab olingan'), genStamp, false],
    [t('Firmalar soni'), d.firms.length, false],
    [t('Mijozlar (kishi) soni'), tt.clients, false],
    [t('Jami ishlar'), tt.total, false],
    [t('Talabnoma yuborilgan'), tt.talabnoma, false],
    [t('Sanoat palatasida'), tt.sanoat, false],
    [t('Sudga chiqarilgan'), tt.sud.total, true],
    [t('MIBga chiqarilgan'), tt.mib, true],
    [t('Jami qarz (soʻm)'), tt.debt, true],
  ];
  for (const [k, v] of kpis) s4.addRow({ k, v });
  const s4From = 4, s4To = 3 + kpis.length;
  zebra(s4, s4From, s4To, 2);
  for (let r = s4From; r <= s4To; r++) {
    const [, v, bold] = kpis[r - s4From];
    if (typeof v === 'number') s4.getRow(r).getCell(2).numFmt = '#,##0';
    if (bold) s4.getRow(r).font = { bold: true };
  }
  s4.getColumn(1).alignment = { vertical: 'middle' };
  s4.getColumn(2).alignment = { horizontal: 'right', vertical: 'middle' };

  // ── 5) Viloyatlar ───────────────────────────────────────────────────────────
  const s5 = wb.addWorksheet(t('Viloyatlar'), { views: [{ state: 'frozen', ySplit: 3, xSplit: 1 }] });
  const S5_COLS = [
    { header: t('Viloyat'), key: 'reg', width: 22 },
    { header: t('Mijozlar'), key: 'cli', width: 11, num: true },
    { header: t('Talabnoma'), key: 'tal', width: 12, num: true },
    { header: t('Sudga (jami)'), key: 'sud', width: 14, num: true },
    { header: t('Qanoatlantirilgan'), key: 'gr', width: 18, num: true, tone: 'FFDCFCE7' },
    { header: t('Qaytarilgan'), key: 'ret', width: 14, num: true, tone: 'FFFEE2E2' },
    { header: t('MIBga'), key: 'mib', width: 12, num: true },
    { header: t('Jami qarz'), key: 'debt', width: 18, money: true },
  ];
  s5.columns = S5_COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  setHeader(s5, { title: t('Viloyatlar boʻyicha'), subtitle: subtitleBase, span: S5_COLS.length });
  s5.spliceRows(1, 0); s5.spliceRows(1, 0);
  const s5Head = s5.getRow(3);
  S5_COLS.forEach((c, i) => { s5Head.getCell(i + 1).value = c.header; });
  styleHead(s5, 3, S5_COLS.length);
  for (const r of d.regions) s5.addRow({ reg: r.region, cli: r.clients, tal: r.talabnoma, sud: r.sudTotal, gr: r.granted, ret: r.returned, mib: r.mib, debt: r.debt });
  const s5From = 4, s5To = 3 + d.regions.length;
  zebra(s5, s5From, s5To, S5_COLS.length);
  S5_COLS.forEach((c, i) => {
    const col = s5.getColumn(i + 1);
    if (c.money) col.numFmt = MONEY; else if (c.num) col.numFmt = '#,##0';
    col.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
  });
  const rt = d.regions.reduce((a, r) => ({ cli: a.cli + r.clients, tal: a.tal + r.talabnoma, sud: a.sud + r.sudTotal, gr: a.gr + r.granted, ret: a.ret + r.returned, mib: a.mib + r.mib, debt: a.debt + r.debt }), { cli: 0, tal: 0, sud: 0, gr: 0, ret: 0, mib: 0, debt: 0 });
  s5.addRow({ reg: t('JAMI'), cli: rt.cli, tal: rt.tal, sud: rt.sud, gr: rt.gr, ret: rt.ret, mib: rt.mib, debt: rt.debt });
  totalRow(s5, s5To + 1, S5_COLS.length, t('JAMI'));
  s5.getRow(s5To + 1).getCell(S5_COLS.length).numFmt = MONEY;
  s5.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: S5_COLS.length } };

  return wb.xlsx.writeBuffer().then((b) => Buffer.from(b as ArrayBuffer));
}

export async function GET(req: NextRequest) {
  await requireAccess('boss-report');
  const t = getT();
  const snaps = await konveyerSnapshots().catch(() => []);
  const q = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = q ? Number(q) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const snapLabel = snaps.find((s) => s.id === selectedId)?.label ?? '—';

  const data = await bossReport(selectedId);
  const buf = await buildBossExcel(data, snapLabel, t);
  // Fayl nomida BUGUNGI sana (yuklab olingan kun) — snapshot sanasi ichida sarlavhada bor.
  const today = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;
  const name = `${t('Boshliq hisoboti')}_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}
