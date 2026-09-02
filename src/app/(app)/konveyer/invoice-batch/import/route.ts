import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import Excel from 'exceljs';
import { requireUser } from '@/lib/auth';
import { importInvoicesFromXlsx } from '@/lib/invoice-import';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET — import uchun NAMUNA (shablon) .xlsx: «BFF …» / farmoyish formati (Қарздор ФИО + Квитанция).
export async function GET() {
  await requireUser();
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.columns = [
    { header: '№', key: 'no', width: 6 },
    { header: 'Қарздор ФИО', key: 'name', width: 40 },
    { header: 'Код', key: 'kod', width: 14 },
    { header: 'Почта харажати', key: 'fee', width: 16 },
    { header: 'Квитанция рақами', key: 'receipt', width: 22 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getColumn('receipt').alignment = { horizontal: 'left' };
  ws.addRow({ no: 1, name: "BOQIYEV XOJIMUROD AZIZBEK O'G'LI", kod: '60155260', fee: 22000, receipt: '262442441838' });
  ws.addRow({ no: 2, name: "BOQIYEVA NILUFAR UMAR QIZI", kod: '60160568', fee: 22000, receipt: '262447865072' });
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent('invoice-import-namuna.xlsx')}"`,
    },
  });
}

// POST (multipart: file=.xlsx, s?=snapshotId) — invoice «To'lov holati»ni Excel'dan yuklaydi
// (reconcile). Kvitansiya/invoice raqami yoki PINFL bo'yicha mos case'ni topib, «Holat» ustuniga
// qarab to'langan/qaytarilgan deb belgilaydi. Hisobot (nechta topildi/belgilandi) qaytadi.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  const file = form?.get('file') as File | null;
  const sRaw = form?.get('s');
  const fRaw = form?.get('firmId');
  const snapshotId = sRaw ? Number(sRaw) : undefined;
  const firmId = fRaw ? Number(fRaw) : undefined;
  const apply = form?.get('mode') === 'apply'; // preview (default) → tasdiqdan keyin apply
  if (!file) return NextResponse.json({ error: 'Fayl yoʻq' }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: 'Faqat .xlsx fayl' }, { status: 400 });

  const tmp = path.join(os.tmpdir(), `inv-import-${crypto.randomUUID()}.xlsx`);
  await fs.writeFile(tmp, Buffer.from(await file.arrayBuffer()));
  try {
    const sid = Number.isInteger(snapshotId) && (snapshotId as number) > 0 ? snapshotId : undefined;
    const fid = Number.isInteger(firmId) && (firmId as number) > 0 ? firmId : undefined;
    const result = await importInvoicesFromXlsx(tmp, { snapshotId: sid, firmId: fid, apply });
    // Tarix (Amaliyotlar/jurnal): faqat tasdiqlanганda (apply) yozamiz.
    if (apply) await audit(AuditAction.IMPORT, { target: fid ? `firm:${fid}` : 'invoice', detail: { kind: 'invoice-kvitansiya', rows: result.totalRows, matched: result.matched, assigned: result.assigned, markedPaid: result.markedPaid } });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import xatosi' }, { status: 422 });
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
