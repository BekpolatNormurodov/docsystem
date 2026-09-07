import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// GET ?firmId= — TO'LANMAGAN kvitansiyali, lekin boshqa jihatdan sudga tayyor ishlar.
//
// NEGA KERAK: portal `save-suit` dan oldin kvitansiyani tekshiradi va to'lanmagani uchun
// «invoiceStatus is not valid» qaytaradi — da'vo umuman ketmaydi. 2026-09-07 o'lchovi:
// sudga ketgan 99 ta ishning HAMMASIDA kvitansiya PAID, yiqilgan 5 tasining HAMMASIDA
// CREATED. Ya'ni to'lov — qat'iy shart, taxmin emas.
//
// Bu ro'yxat buxgalteriya uchun: qaysi kvitansiya to'lanmagan va qancha. To'langach
// billing sinxronizatsiyasi holatni PAID ga o'zgartiradi va ishlar o'zi «Tayyor»ga qaytadi.
export async function GET(req: NextRequest) {
  await requireStep('sud');

  const rawFirm = Number(req.nextUrl.searchParams.get('firmId'));
  const firmId = Number.isInteger(rawFirm) && rawFirm > 0 ? rawFirm : undefined;

  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } });
  const cases = await prisma.arizaCase.findMany({
    where: {
      ...(firmId ? { firmId } : {}),
      ...(snap ? { snapshotId: snap.id } : {}),
      receiptNumber: { not: null },
      stage: { notIn: ['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED'] },
    },
    select: {
      id: true, clientName: true, pinfl: true, receiptNumber: true, totalDebt: true,
      firm: { select: { shortName: true } },
    },
    orderBy: { id: 'asc' },
  });

  const numbers = cases.map((c) => c.receiptNumber!).filter(Boolean);
  const invoices = numbers.length
    ? await prisma.billingCheckInvoice.findMany({
        where: { number: { in: [...new Set(numbers)] } },
        select: { number: true, invoiceStatus: true, amount: true, paidAmount: true, issuedAt: true, expiresAt: true },
      })
    : [];
  const byNumber = new Map(invoices.map((i) => [i.number, i]));

  // To'lanmagan = PAID emas (CREATED / PARTIALLY_PAID / umuman tekshirilmagan).
  const rows = cases
    .map((c) => ({ c, inv: byNumber.get(c.receiptNumber!) }))
    .filter((x) => (x.inv?.invoiceStatus ?? 'TEKSHIRILMAGAN') !== 'PAID');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tolanmagan kvitansiyalar');
  ws.columns = [
    { header: 'Firma', key: 'firma', width: 30 },
    { header: 'Mijoz', key: 'mijoz', width: 38 },
    { header: 'PINFL', key: 'pinfl', width: 18 },
    { header: 'Kvitansiya №', key: 'kvit', width: 18 },
    { header: 'Holat', key: 'holat', width: 16 },
    { header: 'Summa', key: 'summa', width: 14 },
    { header: 'To‘langan', key: 'tolangan', width: 14 },
    { header: 'Qarzdorlik', key: 'qarz', width: 16 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const { c, inv } of rows) {
    ws.addRow({
      firma: c.firm?.shortName ?? '',
      mijoz: c.clientName ?? '',
      pinfl: c.pinfl ?? '',
      kvit: c.receiptNumber ?? '',
      holat: inv?.invoiceStatus ?? 'tekshirilmagan',
      summa: inv?.amount ? Number(inv.amount) : null,
      tolangan: inv?.paidAmount ? Number(inv.paidAmount) : 0,
      qarz: Number(c.totalDebt),
    });
  }
  ws.getColumn('summa').numFmt = '#,##0';
  ws.getColumn('tolangan').numFmt = '#,##0';
  ws.getColumn('qarz').numFmt = '#,##0';

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="tolanmagan-kvitansiyalar-${rows.length}.xlsx"`,
    },
  });
}
