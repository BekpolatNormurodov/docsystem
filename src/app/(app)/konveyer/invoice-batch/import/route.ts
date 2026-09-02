import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { reconcileInvoicesFromXlsx } from '@/lib/invoice-import';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST (multipart: file=.xlsx, s?=snapshotId) — invoice «To'lov holati»ni Excel'dan yuklaydi
// (reconcile). Kvitansiya/invoice raqami yoki PINFL bo'yicha mos case'ni topib, «Holat» ustuniga
// qarab to'langan/qaytarilgan deb belgilaydi. Hisobot (nechta topildi/belgilandi) qaytadi.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  const file = form?.get('file') as File | null;
  const sRaw = form?.get('s');
  const snapshotId = sRaw ? Number(sRaw) : undefined;
  if (!file) return NextResponse.json({ error: 'Fayl yoʻq' }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: 'Faqat .xlsx fayl' }, { status: 400 });

  const tmp = path.join(os.tmpdir(), `inv-import-${crypto.randomUUID()}.xlsx`);
  await fs.writeFile(tmp, Buffer.from(await file.arrayBuffer()));
  try {
    const result = await reconcileInvoicesFromXlsx(tmp, Number.isInteger(snapshotId) && (snapshotId as number) > 0 ? snapshotId : undefined);
    await audit(AuditAction.STAGE_ADVANCE, { target: 'invoice-import', detail: { by: 'excel-import', ...result } as never });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import xatosi' }, { status: 422 });
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
