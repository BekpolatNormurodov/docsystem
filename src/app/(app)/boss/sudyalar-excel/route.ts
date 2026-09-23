// «Sudyalar (Excel)» — Hisobot sahifasidagi Sudya kesimining alohida, ideal Excel eksporti.
// Tarkibi: sarlavha + coverage · 3 insight (eng ko'p qanoatlantiradi / eng past / eng ko'p qaytaradi)
// · saralangan jadval (# · Sudya · Sud · Firmalar · Kishi · Jami · Qanoat · Qaytar · Jarayonda ·
// % qanoat · So'nggi tinglash) · JAMI qatori. Palitra boshqa Excel'lar bilan bir xil.
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import ExcelJS from 'exceljs';
import { requireAccess } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { bossReport } from '@/lib/boss-report';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  await requireAccess('boss-report');
  const t = getT();
  const snaps = await konveyerSnapshots().catch(() => []);
  const q = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = q ? Number(q) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const snapLabel = snaps.find((s) => s.id === selectedId)?.label ?? '—';

  const data = await bossReport(selectedId);
  const J = data.judges;

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.creator = 'Yurist Tizimi';
  const C_TITLE = 'FF134E4A', C_HEAD = 'FF0F766E', C_SECT = 'FFD1EDE7', C_TOT = 'FFEEF2F6', C_BORDER = 'FFD1D5DB', C_ZEBRA = 'FFF7FAF9';
  const thin = { style: 'thin' as const, color: { argb: C_BORDER } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const colL = (nn: number) => { let s = ''; let n = nn; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const now = new Date(); const p2 = (n: number) => String(n).padStart(2, '0');
  const genStamp = `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`;

  const ws = wb.addWorksheet(t('Sudyalar'), { views: [{ state: 'frozen', ySplit: 5, xSplit: 2 }] });
  type Col = { key: string; w: number; h: string; center?: boolean; sum?: boolean; pct?: boolean };
  const COLS: Col[] = [
    { key: 'no',        w: 5,  h: '№',              center: true },
    { key: 'judge',     w: 34, h: t('Sudya') },
    { key: 'court',     w: 26, h: t('Sud') },
    { key: 'firms',     w: 22, h: t('Firmalar') },
    { key: 'clients',   w: 10, h: t('Kishi'),       center: true, sum: true },
    { key: 'total',     w: 11, h: t('Jami ish'),    center: true, sum: true },
    { key: 'granted',   w: 12, h: t('Qanoat.'),     center: true, sum: true },
    { key: 'returned',  w: 12, h: t('Qaytar.'),     center: true, sum: true },
    { key: 'inProcess', w: 12, h: t('Jarayonda'),   center: true, sum: true },
    { key: 'pct',       w: 11, h: t('% qanoat'),    center: true, pct: true },
    { key: 'last',      w: 14, h: t('Soʻnggi tinglash'), center: true },
  ];
  const NC = COLS.length, last = colL(NC);
  ws.columns = COLS.map((c) => ({ key: c.key, width: c.w }));

  // 1-qator: sarlavha
  ws.mergeCells(`A1:${last}1`);
  const c1 = ws.getCell('A1');
  c1.value = t('SUDYALAR HISOBOTI').toUpperCase();
  c1.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  c1.fill = fill(C_TITLE); c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 26;
  // 2-qator: coverage + vaqt
  ws.mergeCells(`A2:${last}2`);
  const cov = J.submittedTotal > 0 ? Math.round((J.withJudge / J.submittedTotal) * 100) : 0;
  const c2 = ws.getCell('A2');
  c2.value = `${t('Snapshot')}: ${snapLabel}   ·   ${J.rows.length} ${t('sudya')}   ·   ${t('Sudya aniqlangan')}: ${J.withJudge.toLocaleString('ru-RU')}/${J.submittedTotal.toLocaleString('ru-RU')} (${cov}%)   ·   ${t('Yuklab olingan')}: ${genStamp}`;
  c2.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
  c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 16;

  // 3-qator: insight (eng ko'p qanoatlantiradi / eng past / eng ko'p qaytaradi) — kamida 5 hal qilingan
  const decided = J.rows.filter((r) => (r.granted + r.returned) >= 5);
  const best = decided.length ? [...decided].sort((a, b) => b.fulfilmentPct - a.fulfilmentPct)[0] : null;
  const worst = decided.length ? [...decided].sort((a, b) => a.fulfilmentPct - b.fulfilmentPct)[0] : null;
  const mostRet = J.rows.length ? [...J.rows].sort((a, b) => b.returned - a.returned)[0] : null;
  const shortName = (full: string) => { const p = full.trim().split(/\s+/); return p.length >= 2 ? `${p[0]} ${p[1]}` : full; };
  ws.mergeCells(`A3:${last}3`);
  const c3 = ws.getCell('A3');
  const parts: string[] = [];
  if (best) parts.push(`${t('Eng ko‘p qanoatlantiradi')}: ${shortName(best.judge)} (${best.fulfilmentPct}%)`);
  if (worst && worst.judge !== best?.judge) parts.push(`${t('Eng past qanoat')}: ${shortName(worst.judge)} (${worst.fulfilmentPct}%)`);
  if (mostRet && mostRet.returned > 0) parts.push(`${t('Eng ko‘p qaytaradi')}: ${shortName(mostRet.judge)} (${mostRet.returned})`);
  c3.value = parts.join('   ·   ');
  c3.font = { size: 10, color: { argb: 'FF134E4A' }, bold: true };
  c3.fill = fill(C_SECT); c3.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(3).height = 18;
  // 4-qator: bo'sh ajratuvchi
  ws.getRow(4).height = 6;

  // 5-qator: ustun sarlavhalari
  const hr = ws.getRow(5); hr.height = 30;
  COLS.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.h; cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(C_HEAD); cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = box;
  });

  const MONEY = '#,##0';
  let no = 0;
  for (const r of J.rows) {
    const dec = r.granted + r.returned;
    ws.addRow({
      no: ++no, judge: r.judge, court: r.courts.join(', '), firms: r.firms.join(', '),
      clients: r.clients, total: r.totalCases, granted: r.granted, returned: r.returned, inProcess: r.inProcess,
      pct: dec > 0 ? r.fulfilmentPct / 100 : null,
      last: r.lastHearing ? new Date(r.lastHearing) : null,
    });
  }
  const from = 6, to = 5 + J.rows.length;
  COLS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.pct) col.numFmt = '0%';
    else if (c.sum) col.numFmt = MONEY;
    if (c.center) col.alignment = { horizontal: 'center' };
  });
  ws.getColumn('last').numFmt = 'dd.mm.yyyy';
  // Zebra + Qanoat/Qaytar/% ranglari
  for (let r = from; r <= to; r++) {
    const row = ws.getRow(r); row.height = 16;
    if ((r - from) % 2 === 1) for (let c = 1; c <= NC; c++) { const cell = row.getCell(c); if (!cell.fill) cell.fill = fill(C_ZEBRA); }
    const g = row.getCell(7), q = row.getCell(8), pc = row.getCell(10);
    if ((g.value as number) > 0) g.font = { color: { argb: 'FF166534' }, bold: true };
    if ((q.value as number) > 0) q.font = { color: { argb: 'FF92400E' }, bold: true };
    const pv = typeof pc.value === 'number' ? pc.value * 100 : null;
    if (pv != null) pc.font = { color: { argb: pv >= 60 ? 'FF166534' : pv >= 30 ? 'FF92400E' : 'FF991B1B' }, bold: true };
  }
  // JAMI
  if (J.rows.length) {
    const tr = ws.getRow(to + 1); tr.height = 18;
    tr.getCell(2).value = t('JAMI');
    for (let c = 1; c <= NC; c++) {
      const cell = tr.getCell(c);
      cell.font = { bold: true }; cell.fill = fill(C_TOT);
      cell.border = { top: { style: 'medium', color: { argb: C_HEAD } }, bottom: thin, left: thin, right: thin };
      if (COLS[c - 1].sum) cell.value = { formula: `SUM(${colL(c)}${from}:${colL(c)}${to})` };
    }
    // Umumiy % qanoat (JAMI)
    const tg = J.rows.reduce((s, r) => s + r.granted, 0);
    const trn = J.rows.reduce((s, r) => s + r.returned, 0);
    const tdec = tg + trn;
    const tpc = tr.getCell(10);
    if (tdec > 0) { tpc.value = tg / tdec; tpc.numFmt = '0%'; tpc.font = { bold: true, color: { argb: (tg / tdec) >= 0.6 ? 'FF166534' : (tg / tdec) >= 0.3 ? 'FF92400E' : 'FF991B1B' } }; }
  }
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: NC } };

  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const name = `${t('Sudyalar hisoboti').replace(/\s+/g, '_')}_${genStamp.replace(/[: ]/g, '_')}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}
