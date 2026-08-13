import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { mibEligibleExport } from '@/lib/konveyer';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET ?s=&firmId= — the FULL MIB enforcement pool (MIB'da + yopilgan) as an .xlsx: qarzdor, PINFL,
// kod, firma, sud ish raqami, holat, sud qarori, natija, MIB ijro ID, qarz. The interim working list
// for filing with MIB by hand until the real MIB API is wired. Uncapped (the on-screen list caps at 500).
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const num = (v: string | null): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(sp.get('s'));
  const firmId = num(sp.get('firmId'));

  let rows;
  try { rows = await mibEligibleExport({ snapshotId, firmId }); }
  catch (e) { console.error('mib-excel failed', e); return NextResponse.json({ error: 'Yuklanmadi' }, { status: 500 }); }
  if (rows.length === 0) return NextResponse.json({ error: "MIB boʻyicha ish yoʻq" }, { status: 422 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('MIB ijro');
  ws.columns = [
    { header: '№', key: 'i', width: 6 },
    { header: 'Qarzdor (F.I.O)', key: 'name', width: 36 },
    { header: 'PINFL', key: 'pinfl', width: 16 },
    { header: 'Kod', key: 'kod', width: 12 },
    { header: 'Firma', key: 'firm', width: 24 },
    { header: 'Sud ish raqami', key: 'case', width: 22 },
    { header: 'Holat', key: 'holat', width: 18 },
    { header: 'Sud qarori', key: 'court', width: 22 },
    { header: 'Natija', key: 'result', width: 26 },
    { header: 'MIB ijro ID', key: 'mib', width: 16 },
    { header: 'Qarz (soʻm)', key: 'debt', width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getColumn('pinfl').numFmt = '@';
  ws.getColumn('case').numFmt = '@';
  ws.getColumn('mib').numFmt = '@';
  rows.forEach((r, i) => ws.addRow({
    i: i + 1,
    name: r.clientName ?? '',
    pinfl: r.pinfl ?? '',
    kod: r.kod ?? '',
    firm: r.firmName,
    case: r.courtCaseNumber || r.courtCaseId || '',
    holat: r.stageLabel,
    court: r.courtStatusLabel ?? '',
    result: r.courtResult ?? '',
    mib: r.mibRef ?? '',
    debt: Math.round(Number(r.totalDebt) || 0),
  }));
  ws.getColumn('debt').numFmt = '#,##0';
  ws.autoFilter = { from: 'A1', to: `K${Math.max(1, ws.rowCount)}` };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const scope = firmId ? `firma-${firmId}` : 'hamma';
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`MIB_ijro_${scope}.xlsx`)}"`,
    },
  });
}
