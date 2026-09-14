import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import ExcelJS from 'exceljs';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { courtReadiness } from '@/lib/court-ready';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const num = (v: string | null): number | undefined => { if (!v) return undefined; const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };

// GET ?s= — per-firm court-readiness statistics («xulosa») as an .xlsx: jami / toʻliq tayyor /
// yuborilgan / navbatda + qaysi hujjat yetishmayotgani (talabnoma/skan/oferta/boji), + a JAMI row.
export async function GET(req: NextRequest) {
  await requireStep('sud:send');
  const t = getT();
  // Resolve snapshot: passed ?s= (validated), else konv_s cookie, else the latest with cases.
  let snapshotId = num(req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null);
  if (snapshotId != null) {
    const hit = await prisma.arizaCase.findFirst({ where: { snapshotId }, select: { snapshotId: true } });
    snapshotId = hit?.snapshotId ?? undefined;
  }
  if (snapshotId == null) {
    const latest = await prisma.arizaCase.findFirst({ where: { snapshotId: { not: null } }, orderBy: { snapshotId: 'desc' }, select: { snapshotId: true } });
    snapshotId = latest?.snapshotId ?? undefined;
  }

  const { firms, overall } = await courtReadiness(snapshotId);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t('Firma statistikasi'));
  ws.columns = [
    { header: '№', key: 'i', width: 6 },
    { header: t('Firma'), key: 'firma', width: 32 },
    { header: t('Jami'), key: 'total', width: 10 },
    { header: t('Toʻliq tayyor'), key: 'ready', width: 14 },
    { header: t('Yuborilgan'), key: 'exported', width: 12 },
    { header: t('Yuborishga tayyor'), key: 'sendable', width: 18 },
    { header: t('Talabnoma yoʻq'), key: 'mtal', width: 15 },
    { header: t('Skan yoʻq'), key: 'mscan', width: 11 },
    { header: t('Oferta yoʻq'), key: 'mof', width: 12 },
    { header: t('Boji yoʻq'), key: 'mboji', width: 11 },
  ];
  ws.getRow(1).font = { bold: true };
  // Most work-to-do first (navbatda desc, then not-ready).
  const sorted = [...firms].sort((a, b) => b.sendable - a.sendable || (b.total - b.ready) - (a.total - a.ready));
  sorted.forEach((f, i) => ws.addRow({
    i: i + 1, firma: f.firmName, total: f.total, ready: f.ready, exported: f.exported, sendable: f.sendable,
    mtal: f.missing.talabnoma, mscan: f.missing.scan, mof: f.missing.oferta, mboji: f.missing.boji,
  }));
  const totalRow = ws.addRow({
    i: '', firma: t('JAMI'), total: overall.total, ready: overall.ready, exported: overall.exported, sendable: overall.sendable,
    mtal: overall.missing.talabnoma, mscan: overall.missing.scan, mof: overall.missing.oferta, mboji: overall.missing.boji,
  });
  totalRow.font = { bold: true };
  ws.autoFilter = { from: 'A1', to: 'J1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent('Sud_firma_statistikasi.xlsx')}"`,
    },
  });
}
