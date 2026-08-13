import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { cabinetReturnedCases } from '@/lib/court-returns';

export const runtime = 'nodejs';
export const maxDuration = 120;

const dmy = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

// GET ?s=&firmId= — the cabinet-returned clients as an .xlsx (to work through re-filing).
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const num = (v: string | null): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(sp.get('s'));
  const firmId = num(sp.get('firmId'));

  let returns;
  try { returns = await cabinetReturnedCases(snapshotId, firmId); }
  catch (e) { console.error('court-returns-excel failed', e); return NextResponse.json({ error: 'Yuklanmadi' }, { status: 500 }); }
  if (returns.length === 0) return NextResponse.json({ error: 'Qaytgan ish yoʻq' }, { status: 422 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Qaytganlar');
  ws.columns = [
    { header: '№', key: 'i', width: 6 },
    { header: 'F.I.O', key: 'name', width: 36 },
    { header: 'PINFL', key: 'pinfl', width: 16 },
    { header: 'Firma', key: 'firm', width: 26 },
    { header: 'Ish raqami', key: 'case', width: 22 },
    { header: 'Natija', key: 'result', width: 20 },
    { header: 'Ajrim sanasi', key: 'date', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getColumn('pinfl').numFmt = '@';
  returns.forEach((r, i) => ws.addRow({
    i: i + 1, name: r.clientName, pinfl: r.pinfl ?? '', firm: r.firmName,
    case: r.caseNumber ?? '', result: r.resultLabel, date: dmy(r.definitionDate),
  }));
  ws.autoFilter = { from: 'A1', to: `G${Math.max(1, ws.rowCount)}` };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent('Suddan_qaytganlar.xlsx')}"`,
    },
  });
}
