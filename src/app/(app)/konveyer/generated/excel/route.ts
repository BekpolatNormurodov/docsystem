import { NextRequest, NextResponse } from 'next/server';
import Excel from 'exceljs';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

const numArg = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };

// GET ?snapshotId=&firmId=&type=ariza|oferta&q= — «Yaratilganlar» ro'yxatini (butun, sahifasiz)
// Excel qilib beradi: №, F.I.O, PINFL, Firma, Sud, Sana. Umumiy skachat uchun.
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const snapshotId = numArg(sp.get('snapshotId'));
  const firmId = numArg(sp.get('firmId'));
  const isOferta = sp.get('type') === 'oferta';
  const q = (sp.get('q') || '').trim();

  const where = {
    ...(snapshotId ? { snapshotId } : {}),
    ...(firmId ? { firmId } : {}),
    ...(isOferta ? { ofertaAt: { not: null } } : { arizaAt: { not: null } }),
    ...(q ? { OR: [{ pinfl: { contains: q } }, { clientName: { contains: q } }] } : {}),
  };

  const rows = await prisma.arizaCase.findMany({
    where,
    orderBy: isOferta ? [{ ofertaAt: 'desc' }, { id: 'desc' }] : [{ arizaAt: 'desc' }, { id: 'desc' }],
    take: 100_000,
    select: { pinfl: true, clientName: true, kod: true, arizaAt: true, ofertaAt: true, firm: { select: { shortName: true } }, court: { select: { shortName: true } } },
  });

  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet(isOferta ? 'Ofertalar' : 'Arizalar');
  ws.columns = [
    { header: '№', key: 'n', width: 6 },
    { header: 'F.I.O', key: 'name', width: 42 },
    { header: 'PINFL', key: 'pinfl', width: 18 },
    { header: 'Firma', key: 'firm', width: 30 },
    { header: 'Sud', key: 'court', width: 28 },
    { header: 'Yaratilgan sana', key: 'at', width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  const fmt = (d: Date | null) => (d ? d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  rows.forEach((r, i) => {
    ws.addRow({
      n: i + 1,
      name: r.clientName ?? '',
      pinfl: r.pinfl ?? '',
      firm: r.firm?.shortName ?? r.kod ?? '',
      court: r.court?.shortName ?? '',
      at: fmt(isOferta ? r.ofertaAt : r.arizaAt),
    });
  });
  ws.getColumn('pinfl').alignment = { horizontal: 'left' };
  ws.autoFilter = { from: 'A1', to: 'F1' };

  const buf = await wb.xlsx.writeBuffer();
  const label = isOferta ? 'Ofertalar' : 'Arizalar';
  const fname = `${label}_royxati_${rows.length}.xlsx`;
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fname)}"`,
    },
  });
}
