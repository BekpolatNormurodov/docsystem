import { NextRequest, NextResponse } from 'next/server';
import Excel from 'exceljs';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

const numArg = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };

const PAID_BEYOND = new Set(['INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED']);
const holatOf = (stage: string): string => (!PAID_BEYOND.has(stage) ? 'Toʻlanmagan' : stage === 'INVOICE_PAID' ? 'Toʻlandi' : 'Sudda');

// GET ?snapshotId=&firmId=&type=ariza|oferta|invoice&q= — «Yaratilganlar» ro'yxatini (butun, sahifasiz)
// Excel qilib beradi: №, F.I.O, PINFL, Firma, Sud (+ Kvitansiya), Sana. Umumiy skachat uchun.
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const snapshotId = numArg(sp.get('snapshotId'));
  const firmId = numArg(sp.get('firmId'));
  const type = sp.get('type');
  const isOferta = type === 'oferta';
  const isInvoice = type === 'invoice';
  const q = (sp.get('q') || '').trim();

  const made = sp.get('made');
  const invoiceScope = made === 'notmade' ? { receiptNumber: null } : made === 'all' ? {} : { receiptNumber: { not: null } };
  const scope = isInvoice ? invoiceScope : isOferta ? { ofertaAt: { not: null } } : { arizaAt: { not: null } };
  const qOr = q
    ? { OR: [{ pinfl: { contains: q } }, { clientName: { contains: q } }, ...(isInvoice ? [{ receiptNumber: { contains: q } }, { invoiceNo: { contains: q } }] : [])] }
    : {};
  const where = { ...(snapshotId ? { snapshotId } : {}), ...(firmId ? { firmId } : {}), ...scope, ...qOr };

  const rows = await prisma.arizaCase.findMany({
    where,
    orderBy: isInvoice ? [{ id: 'desc' }] : isOferta ? [{ ofertaAt: 'desc' }, { id: 'desc' }] : [{ arizaAt: 'desc' }, { id: 'desc' }],
    take: 100_000,
    select: {
      pinfl: true, clientName: true, kod: true, arizaAt: true, ofertaAt: true, receiptNumber: true, invoiceNo: true, stage: true,
      firm: { select: { shortName: true } }, court: { select: { shortName: true } },
      ...(isInvoice ? { invoiceRecords: { select: { createdAt: true }, orderBy: { createdAt: 'desc' as const }, take: 1 } } : {}),
    },
  });

  const wb = new Excel.Workbook();
  const sheetName = isInvoice ? 'Invoyslar' : isOferta ? 'Ofertalar' : 'Arizalar';
  const ws = wb.addWorksheet(sheetName);
  ws.columns = [
    { header: '№', key: 'n', width: 6 },
    { header: 'F.I.O', key: 'name', width: 42 },
    { header: 'PINFL', key: 'pinfl', width: 18 },
    { header: 'Firma', key: 'firm', width: 30 },
    { header: 'Sud', key: 'court', width: 28 },
    ...(isInvoice ? [{ header: 'Kvitansiya raqami', key: 'receipt', width: 20 }, { header: 'Holat', key: 'holat', width: 14 }] : []),
    { header: 'Yaratilgan sana', key: 'at', width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  rows.forEach((r, i) => {
    const at = isInvoice
      ? (r as { invoiceRecords?: { createdAt: Date }[] }).invoiceRecords?.[0]?.createdAt ?? null
      : isOferta ? r.ofertaAt : r.arizaAt;
    ws.addRow({
      n: i + 1,
      name: r.clientName ?? '',
      pinfl: r.pinfl ?? '',
      firm: r.firm?.shortName ?? r.kod ?? '',
      court: r.court?.shortName ?? '',
      ...(isInvoice ? { receipt: r.receiptNumber ?? r.invoiceNo ?? '', holat: r.receiptNumber ? holatOf(r.stage) : 'Chiqarilmagan' } : {}),
      at: fmt(at),
    });
  });
  ws.getColumn('pinfl').alignment = { horizontal: 'left' };
  const lastCol = String.fromCharCode(64 + ws.columns.length); // A..F (ariza/oferta) / A..H (invoice)
  ws.autoFilter = { from: 'A1', to: `${lastCol}1` };

  // Tarix (Amaliyotlar/jurnal): eksport qilindi.
  await audit(AuditAction.EXPORT, { target: firmId ? `firm:${firmId}` : sheetName, detail: { list: sheetName, count: rows.length, ...(isInvoice ? { made: made || 'made' } : {}) } });

  const buf = await wb.xlsx.writeBuffer();
  const fname = `${sheetName}_royxati_${rows.length}.xlsx`;
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fname)}"`,
    },
  });
}
