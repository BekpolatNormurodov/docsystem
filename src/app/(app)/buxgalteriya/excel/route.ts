import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import Excel from 'exceljs';
import { requireAccess } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { buxgalteriyaData } from '@/lib/buxgalteriya';

export const runtime = 'nodejs';

// GET ?firmId= — buxgalteriya ro'yxatini Excel qilib beradi (firma bo'yicha yoki hammasi),
// tanlangan snapshot uchun. Ustunlar: Firma · Mijoz · Kvitansiya raqami · Summa · Holat.
export async function GET(req: NextRequest) {
  await requireAccess('buxgalteriya');

  const snaps = await konveyerSnapshots().catch(() => []);
  const raw = cookies().get('konv_s')?.value;
  const parsed = raw ? Number(raw) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const sel = snaps.find((s) => s.id === selectedId);

  const fid = req.nextUrl.searchParams.get('firmId');
  const firmId = fid ? Number(fid) : undefined;

  const data = await buxgalteriyaData(selectedId);
  const firms = firmId ? data.firms.filter((f) => f.firmId === firmId) : data.firms;

  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet('Buxgalteriya');
  ws.columns = [
    { header: 'Firma', key: 'firm', width: 28 },
    { header: 'Mijoz', key: 'client', width: 34 },
    { header: 'Kvitansiya raqami', key: 'receipt', width: 20 },
    { header: 'Summa', key: 'amount', width: 14 },
    { header: 'Holat', key: 'status', width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const f of firms) {
    for (const r of f.rows) {
      ws.addRow({
        firm: f.firmName,
        client: r.clientName ?? '',
        receipt: r.receiptNumber ?? '',
        amount: data.amount,
        status: r.paid ? "To'langan" : "To'lanmagan",
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const nameBase = firmId && firms[0] ? firms[0].firmName.replace(/[^\x20-\x7E]/g, '').trim() || 'firma' : 'hammasi';
  const fileName = `buxgalteriya_${nameBase}_${sel?.label ?? ''}.xlsx`.replace(/\s+/g, '_');
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}
