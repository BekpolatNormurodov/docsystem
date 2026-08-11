import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/auth';
import { getRestBatch, getRestBatchPdfs } from '@/lib/invoice-rest';

export const runtime = 'nodejs';

// GET — batchdagi barcha muvaffaqiyatli invoice PDF'larini bitta ZIP qilib beradi.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const b = await getRestBatch(params.id);
  if (!b) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });

  const pdfs = await getRestBatchPdfs(params.id);
  if (pdfs.length === 0) return NextResponse.json({ error: 'Yuklangan PDF yoʻq' }, { status: 404 });

  const zip = new JSZip();
  for (const { invoiceNo } of pdfs) {
    try {
      const buf = await fs.readFile(path.join(process.cwd(), 'storage', 'invoices', `${invoiceNo}.pdf`));
      zip.file(`${invoiceNo}.pdf`, buf);
    } catch { /* fayl topilmasa o'tkazamiz */ }
  }
  const out = await zip.generateAsync({ type: 'nodebuffer' });
  return new NextResponse(new Uint8Array(out), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Invoices_${params.id}.zip`)}"`,
    },
  });
}
