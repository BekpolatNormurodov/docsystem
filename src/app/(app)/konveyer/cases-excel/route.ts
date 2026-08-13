import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { konveyerPersons, type PersonRow } from '@/lib/konveyer';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET ?firmId=&s=&stages=&talabnoma= — the current Mijozlar list (one row per person, unified across
// firms) as an .xlsx: F.I.O, PINFL, kod, firmalar, jami qarzdorlik, boji, muddat. Same scope/filters
// as the on-screen list (konveyerPersons), just all pages instead of one.
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const num = (raw: string | null): number | undefined => { const n = Number(raw); return raw != null && raw !== '' && Number.isFinite(n) ? n : undefined; };
  const firmId = num(sp.get('firmId'));
  const stages = (sp.get('stages') || '').split(',').filter(Boolean) as CaseStage[];
  const talabnoma = sp.get('talabnoma') === '1';
  const snapshotId = num(sp.get('s'));

  // Page through the same query the list uses (pageSize is clamped to 50 inside konveyerPersons).
  const persons: PersonRow[] = [];
  try {
    for (let page = 1; page <= 2000; page++) {
      const d = await konveyerPersons({ firmId, snapshotId, stages, talabnoma, page, pageSize: 50 });
      persons.push(...d.persons);
      if (d.persons.length === 0 || page >= d.pages) break;
    }
  } catch (e) {
    console.error('cases-excel query failed', e);
    return NextResponse.json({ error: 'Mijozlar yuklanmadi' }, { status: 500 });
  }
  if (persons.length === 0) return NextResponse.json({ error: 'Bu tanlovda mijoz yoʻq' }, { status: 422 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Mijozlar');
  ws.columns = [
    { header: '№', key: 'i', width: 6 },
    { header: 'F.I.O', key: 'name', width: 38 },
    { header: 'PINFL', key: 'pinfl', width: 16 },
    { header: 'Kod', key: 'kod', width: 12 },
    { header: 'Firmalar', key: 'firms', width: 10 },
    { header: 'Jami qarzdorlik (soʻm)', key: 'debt', width: 22 },
    { header: 'Boji (invoice)', key: 'boji', width: 14 },
    { header: 'Muddat (kun)', key: 'days', width: 13 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getColumn('pinfl').numFmt = '@';
  persons.forEach((p, i) => {
    ws.addRow({
      i: i + 1,
      name: p.clientName ?? '',
      pinfl: p.pinfl ?? '',
      kod: p.kod ?? '',
      firms: p.firmCount,
      debt: Math.round(Number(p.totalDebt) || 0),
      boji: p.hasInvoice ? 'bor' : '',
      days: p.minDaysLeft ?? '',
    });
  });
  ws.getColumn('debt').numFmt = '#,##0';
  ws.autoFilter = { from: 'A1', to: `H${Math.max(1, ws.rowCount)}` };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const scope = firmId ? `firma-${firmId}` : 'hamma';
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Mijozlar_${scope}.xlsx`)}"`,
    },
  });
}
