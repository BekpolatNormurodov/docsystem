import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { palataScanSummary } from '@/lib/palata-scan';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET → the whole palata scan list as an .xlsx (F.I.Sh, JShShIR, firma, manzil, holat).
export async function GET() {
  await requireUser();
  const t = getT();
  const s = await palataScanSummary();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t('Palatadan kelgan'));
  ws.columns = [
    { header: '#', key: 'i', width: 5 },
    { header: t('F.I.Sh'), key: 'name', width: 34 },
    { header: t('JShShIR'), key: 'pinfl', width: 18 },
    { header: t('Firma'), key: 'firm', width: 28 },
    { header: t('Manzil'), key: 'address', width: 46 },
    { header: t('Holat'), key: 'holat', width: 16 },
  ];
  s.arizas.forEach((a, i) => ws.addRow({
    i: i + 1, name: a.name, pinfl: a.pinfl, firm: a.firm, address: a.address,
    holat: a.hasCase ? t('ish bor') : a.hasPortfolio ? t('ish yoʻq') : t('portfelda yoʻq'),
  }));
  ws.getRow(1).font = { bold: true };
  ws.getColumn('pinfl').numFmt = '@'; // keep PINFL as text (no 5.16E+13)
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`${t('Palatadan kelgan').replace(/\s+/g, '_')}.xlsx`)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
