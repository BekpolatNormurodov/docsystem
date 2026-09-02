import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import Excel from 'exceljs';
import { requireUser } from '@/lib/auth';
import { reconcileInvoicesFromXlsx } from '@/lib/invoice-import';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET — import uchun NAMUNA (shablon) .xlsx: to'g'ri sarlavhalar + 2 misol qator.
export async function GET() {
  await requireUser();
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet('Import');
  ws.columns = [
    { header: 'Kvitansiya raqami', key: 'receipt', width: 22 },
    { header: 'Invoice raqami', key: 'invoice', width: 20 },
    { header: 'PINFL', key: 'pinfl', width: 18 },
    { header: 'Holat', key: 'status', width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getColumn('pinfl').alignment = { horizontal: 'left' };
  ws.addRow({ receipt: '262196086404', invoice: '', pinfl: '', status: "To'landi" });
  ws.addRow({ receipt: '', invoice: '', pinfl: '30101995123456', status: "To'lanmagan" });
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
  const snapshotId = sRaw ? Number(sRaw) : undefined;
  const apply = form?.get('mode') === 'apply'; // preview (default) → tasdiqdan keyin apply
  if (!file) return NextResponse.json({ error: 'Fayl yoʻq' }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: 'Faqat .xlsx fayl' }, { status: 400 });

  const tmp = path.join(os.tmpdir(), `inv-import-${crypto.randomUUID()}.xlsx`);
  await fs.writeFile(tmp, Buffer.from(await file.arrayBuffer()));
  try {
    const sid = Number.isInteger(snapshotId) && (snapshotId as number) > 0 ? snapshotId : undefined;
    const result = await reconcileInvoicesFromXlsx(tmp, { snapshotId: sid, apply });
    if (apply) await audit(AuditAction.STAGE_ADVANCE, { target: 'invoice-import', detail: { by: 'excel-import', ...result } as never });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import xatosi' }, { status: 422 });
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
