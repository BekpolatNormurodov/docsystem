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

  // ── Varaq 1: mijoz bo'yicha (bir qator = bir kishi) ──
  const s1 = wb.addWorksheet(t('Mijozlar (holat)'));
  s1.columns = [
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
  s1.getRow(1).font = { bold: true };
  s1.getColumn('pinfl').numFmt = '@';
  s1.getColumn('debt').numFmt = '#,##0';
  s1.autoFilter = { from: 'A1', to: `I${Math.max(1, s1.rowCount)}` };
  s1.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Varaq 2: firma bo'yicha yoyilgan (bir qator = bir kishi × firma ishi) ──
  const s2 = wb.addWorksheet(t('Firma bo‘yicha'));
  s2.columns = [
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
  for (const p of persons) {
    for (const c of p.cases) {
      const cb = c.courtStatus ? courtBadge(c.courtStatus, c.courtStatusLabel, c.courtResult) : null;
      s2.addRow({
        name: p.clientName ?? '',
        pinfl: p.pinfl ?? '',
        firm: c.firmName,
        stage: c.stageLabel,
        court: cb?.label ?? '',
        result: c.courtResult ?? '',
        caseno: c.courtCaseId ?? '',
        boji: c.receiptNumber ? `№${c.receiptNumber}` : '',
        debt: Math.round(Number(c.totalDebt) || 0),
        days: c.daysLeft ?? '',
      });
    }
  }
  s2.getRow(1).font = { bold: true };
  s2.getColumn('pinfl').numFmt = '@';
  s2.getColumn('debt').numFmt = '#,##0';
  s2.autoFilter = { from: 'A1', to: `J${Math.max(1, s2.rowCount)}` };
  s2.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const tag = step || (stages.length ? 'bosqich' : 'hammasi');
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`${t('Mijozlar holati').replace(/\s+/g, '_')}_${tag}.xlsx`)}"`,
    },
  });
}
