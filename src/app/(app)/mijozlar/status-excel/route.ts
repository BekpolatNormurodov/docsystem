import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { konveyerPersons, PHASES, type PersonRow } from '@/lib/konveyer';
import { courtBadge } from '@/lib/court-result';
import type { CaseStage } from '@prisma/client';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const firmShort = (name: string) => (name || '').trim().split(/\s+/)[0] || name;

// Mijoz-holati eksporti (firma · bosqich · sud holati) — Mijozlar VA Hisobot bo'limlaridan.
// Ekrandagi ro'yxat bilan bir xil scope/filtr (konveyerPersons): s (snapshot), stages (bosqich), q.
// GET ?s=&stages=&q=  → ikki varaqli .xlsx (1: mijoz bo'yicha, 2: firma bo'yicha yoyilgan).
export async function GET(req: NextRequest) {
  await requireUser();
  const t = getT();
  const sp = req.nextUrl.searchParams;
  const num = (raw: string | null): number | undefined => { const n = Number(raw); return raw != null && raw !== '' && Number.isFinite(n) ? n : undefined; };
  const snapshotId = num(sp.get('s'));
  const q = sp.get('q')?.trim() || undefined;
  // `stages` to'g'ridan-to'g'ri, yoki `step` (faza kaliti) orqali — mijozlar filtri step yuboradi.
  let stages = (sp.get('stages') || '').split(',').filter(Boolean) as CaseStage[];
  const step = sp.get('step');
  if (!stages.length && step) stages = (PHASES.find((p) => p.key === step)?.stages ?? []) as CaseStage[];

  const persons: PersonRow[] = [];
  try {
    for (let page = 1; page <= 2000; page++) {
      const d = await konveyerPersons({ snapshotId, stages, q, page, pageSize: 50 });
      persons.push(...d.persons);
      if (d.persons.length === 0 || page >= d.pages) break;
    }
  } catch (e) {
    console.error('status-excel query failed', e);
    return NextResponse.json({ error: t('Mijozlar yuklanmadi') }, { status: 500 });
  }
  if (persons.length === 0) return NextResponse.json({ error: t('Bu tanlovda mijoz yoʻq') }, { status: 422 });

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.creator = 'Yurist Tizimi';
  // Sud formasi bilan bir palitrada — foydalanuvchi butun sistemada bir xil ko'rinishni ko'radi.
  const C_TITLE = 'FF134E4A', C_HEAD = 'FF0F766E', C_TOT = 'FFEEF2F6', C_BORDER = 'FFD1D5DB', C_ZEBRA = 'FFF7FAF9';
  const thin = { style: 'thin' as const, color: { argb: C_BORDER } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const colL = (nn: number) => { let s = ''; let n = nn; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const now = new Date(); const p2 = (n: number) => String(n).padStart(2, '0');
  const genStamp = `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const setHeader = (ws: ExcelJS.Worksheet, title: string, subtitle: string, span: number) => {
    const last = colL(span);
    ws.mergeCells(`A1:${last}1`);
    const t1 = ws.getCell('A1'); t1.value = title.toUpperCase();
    t1.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    t1.fill = fill(C_TITLE); t1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 24;
    ws.mergeCells(`A2:${last}2`);
    const t2 = ws.getCell('A2'); t2.value = subtitle;
    t2.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
    t2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(2).height = 16;
  };
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
        const cell = row.getCell(c); cell.border = box;
        if ((r - from) % 2 === 1 && !cell.fill) cell.fill = fill(C_ZEBRA);
      }
    }
  };
  const totalDebt = persons.reduce((s, p) => s + (Number(p.totalDebt) || 0), 0);
  const subtitle = `${persons.length.toLocaleString('ru-RU')} ${t('mijoz')}   ·   ${t('Jami qarz')}: ${totalDebt.toLocaleString('ru-RU')} ${t('soʻm')}   ·   ${t('Yuklab olingan')}: ${genStamp}${stages.length ? `   ·   ${t('Bosqich')}: ${stages.join(', ')}` : ''}`;

  // ── Varaq 1: mijoz bo'yicha (bir qator = bir kishi) ──
  const S1 = [
    { header: '№', key: 'i', width: 6 },
    { header: t('F.I.O'), key: 'name', width: 38 },
    { header: 'PINFL', key: 'pinfl', width: 16 },
    { header: t('Firmalar'), key: 'firms', width: 10 },
    { header: t('Firma · bosqich'), key: 'steps', width: 48 },
    { header: t('Sud holati'), key: 'court', width: 26 },
    { header: t('Sud ish raqami'), key: 'caseno', width: 20 },
    { header: t('Umumiy qarz (soʻm)'), key: 'debt', width: 20 },
    { header: t('Muddat (kun)'), key: 'days', width: 13 },
  ];
  const s1 = wb.addWorksheet(t('Mijozlar (holat)'), { views: [{ state: 'frozen', ySplit: 3 }] });
  s1.columns = S1.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  setHeader(s1, t('Mijozlar holati'), subtitle, S1.length);
  s1.spliceRows(1, 0); s1.spliceRows(1, 0);
  S1.forEach((c, i) => { s1.getRow(3).getCell(i + 1).value = c.header; });
  styleHead(s1, 3, S1.length);
  persons.forEach((p, i) => {
    const bad = p.cases.find((c) => c.courtStatus && courtBadge(c.courtStatus, c.courtStatusLabel, c.courtResult)?.bad);
    const any = bad ?? p.cases.find((c) => c.courtStatus);
    const cb = any ? courtBadge(any.courtStatus, any.courtStatusLabel, any.courtResult) : null;
    s1.addRow({
      i: i + 1,
      name: p.clientName ?? '',
      pinfl: p.pinfl ?? '',
      firms: p.firmCount,
      steps: p.cases.map((c) => `${firmShort(c.firmName)}: ${c.stageLabel}`).join('; '),
      court: cb?.label ?? '',
      caseno: p.cases.map((c) => c.courtCaseId).filter(Boolean).join(', '),
      debt: Math.round(Number(p.totalDebt) || 0),
      days: p.minDaysLeft ?? '',
    });
  });
  const s1From = 4, s1To = 3 + persons.length;
  zebra(s1, s1From, s1To, S1.length);
  s1.getColumn('pinfl').numFmt = '@';
  s1.getColumn('debt').numFmt = '#,##0';
  s1.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: S1.length } };
  // JAMI qatori
  const s1Tot = s1.getRow(s1To + 1); s1Tot.height = 18;
  for (let c = 1; c <= S1.length; c++) {
    const cell = s1Tot.getCell(c);
    cell.font = { bold: true }; cell.fill = fill(C_TOT);
    cell.border = { top: { style: 'medium', color: { argb: C_HEAD } }, bottom: thin, left: thin, right: thin };
  }
  s1Tot.getCell(2).value = t('JAMI');
  s1Tot.getCell(4).value = persons.length;
  s1Tot.getCell(8).value = totalDebt; s1Tot.getCell(8).numFmt = '#,##0';

  // ── Varaq 2: firma bo'yicha yoyilgan (bir qator = bir kishi × firma ishi) ──
  const S2 = [
    { header: t('F.I.O'), key: 'name', width: 38 },
    { header: 'PINFL', key: 'pinfl', width: 16 },
    { header: t('Firma'), key: 'firm', width: 26 },
    { header: t('Bosqich'), key: 'stage', width: 22 },
    { header: t('Sud holati'), key: 'court', width: 26 },
    { header: t('Sud natijasi'), key: 'result', width: 22 },
    { header: t('Sud ish raqami'), key: 'caseno', width: 20 },
    { header: t('Boji (invoice)'), key: 'boji', width: 16 },
    { header: t('Qarz (soʻm)'), key: 'debt', width: 18 },
    { header: t('Muddat (kun)'), key: 'days', width: 13 },
  ];
  const s2 = wb.addWorksheet(t('Firma bo‘yicha'), { views: [{ state: 'frozen', ySplit: 3 }] });
  s2.columns = S2.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  setHeader(s2, t('Firma boʻyicha yoyilgan'), subtitle, S2.length);
  s2.spliceRows(1, 0); s2.spliceRows(1, 0);
  S2.forEach((c, i) => { s2.getRow(3).getCell(i + 1).value = c.header; });
  styleHead(s2, 3, S2.length);
  let s2Cnt = 0; let s2Debt = 0;
  for (const p of persons) {
    for (const c of p.cases) {
      const cb = c.courtStatus ? courtBadge(c.courtStatus, c.courtStatusLabel, c.courtResult) : null;
      s2.addRow({
        name: p.clientName ?? '', pinfl: p.pinfl ?? '', firm: c.firmName, stage: c.stageLabel,
        court: cb?.label ?? '', result: c.courtResult ?? '', caseno: c.courtCaseId ?? '',
        boji: c.receiptNumber ? `№${c.receiptNumber}` : '',
        debt: Math.round(Number(c.totalDebt) || 0), days: c.daysLeft ?? '',
      });
      s2Cnt++; s2Debt += Math.round(Number(c.totalDebt) || 0);
    }
  }
  const s2From = 4, s2To = 3 + s2Cnt;
  zebra(s2, s2From, s2To, S2.length);
  s2.getColumn('pinfl').numFmt = '@';
  s2.getColumn('debt').numFmt = '#,##0';
  s2.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: S2.length } };
  const s2Tot = s2.getRow(s2To + 1); s2Tot.height = 18;
  for (let c = 1; c <= S2.length; c++) {
    const cell = s2Tot.getCell(c);
    cell.font = { bold: true }; cell.fill = fill(C_TOT);
    cell.border = { top: { style: 'medium', color: { argb: C_HEAD } }, bottom: thin, left: thin, right: thin };
  }
  s2Tot.getCell(1).value = t('JAMI');
  s2Tot.getCell(9).value = s2Debt; s2Tot.getCell(9).numFmt = '#,##0';

  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const tag = step || (stages.length ? 'bosqich' : 'hammasi');
  // Fayl nomida BUGUNGI sana (yuklab olingan kun) — foydalanuvchi qaysi kun tortib olganini biladi.
  const today = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`${t('Mijozlar holati').replace(/\s+/g, '_')}_${tag}_${stamp}.xlsx`)}"`,
    },
  });
}
