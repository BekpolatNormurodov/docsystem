import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import Excel from 'exceljs';
import { requireAccess } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { buxgalteriyaData } from '@/lib/buxgalteriya';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';

// GET ?firmId= — buxgalteriya ro'yxatini Excel qilib beradi (firma bo'yicha yoki hammasi),
// tanlangan snapshot uchun. Ustunlar: Firma · Mijoz · Kvitansiya raqami · Summa · Holat.
export async function GET(req: NextRequest) {
  await requireAccess('buxgalteriya');
  const t = getT();

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
  const ws = wb.addWorksheet(t('Buxgalteriya'));
  ws.columns = [
    { header: '№', key: 'no', width: 5 },
    { header: t('Firma'), key: 'firm', width: 26 },
    { header: t('Qarzdor F.I.O.'), key: 'client', width: 34 },
    { header: t('Kod'), key: 'kod', width: 14 },
    { header: t('Kvitansiya raqami'), key: 'receipt', width: 20 },
    { header: t('Invoice raqami'), key: 'invoice', width: 18 },
    { header: t('Summa'), key: 'amount', width: 14 },
    { header: t('Holat'), key: 'status', width: 16 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { horizontal: 'center' };

  let no = 0;
  for (const f of firms) {
    for (const r of f.rows) {
      no += 1;
      const row = ws.addRow({
        no,
        firm: f.firmName,
        client: r.clientName ?? '',
        kod: r.kod ?? '',
        receipt: r.receiptNumber ?? '',
        invoice: r.invoiceNo ?? '',
        amount: r.amount,
        status: r.paid ? t("To'langan") : t("To'lanmagan"),
      });
      row.getCell('amount').numFmt = '#,##0';
    }
    // Firma bo'yicha yakun (soni + summasi)
    const sub = ws.addRow({ client: `${f.firmName} — ${t('jami')}`, receipt: `${f.total} ${t('ta')}`, amount: f.sum, status: `${f.paid} ${t("to'langan")}` });
    sub.font = { bold: true };
    sub.getCell('amount').numFmt = '#,##0';
  }
  // Umumiy yakun
  const grand = ws.addRow({ client: t('HAMMASI'), receipt: `${data.total} ${t('ta')}`, amount: data.sum, status: `${data.paidCount} ${t("to'langan")} / ${data.unpaidCount} ${t("to'lanmagan")}` });
  grand.font = { bold: true };
  grand.getCell('amount').numFmt = '#,##0';

  const buf = await wb.xlsx.writeBuffer();
  const nameBase = firmId && firms[0] ? firms[0].firmName.replace(/[^\x20-\x7E]/g, '').trim() || 'firma' : 'hammasi';
  const fileName = `${t('Buxgalteriya')}_${nameBase}_${sel?.label ?? ''}.xlsx`.replace(/\s+/g, '_');
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}
