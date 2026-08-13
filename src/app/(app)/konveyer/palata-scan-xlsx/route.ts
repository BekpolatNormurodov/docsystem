import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { palataScanSummary } from '@/lib/palata-scan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET → the whole palata scan list as an .xlsx (F.I.Sh, JShShIR, firma, manzil, holat).
export async function GET() {
  await requireUser();
  const s = await palataScanSummary();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Palatadan kelgan');
  ws.columns = [
    { header: '#', key: 'i', width: 5 },
    { header: 'F.I.Sh', key: 'name', width: 34 },
    { header: 'JShShIR', key: 'pinfl', width: 18 },
    { header: 'Firma', key: 'firm', width: 28 },
    { header: 'Manzil', key: 'address', width: 46 },
    { header: 'Holat', key: 'holat', width: 16 },
  ];
  s.arizas.forEach((a, i) => ws.addRow({
    i: i + 1, name: a.name, pinfl: a.pinfl, firm: a.firm, address: a.address,
    holat: a.hasCase ? 'ish bor' : a.hasPortfolio ? 'ish yoʻq' : 'portfelda yoʻq',
  }));
  ws.getRow(1).font = { bold: true };
  ws.getColumn('pinfl').numFmt = '@'; // keep PINFL as text (no 5.16E+13)
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="palata-skan.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
