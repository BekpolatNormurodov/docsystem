import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { requireAdmin } from '@/lib/auth';
import { readScannedArizas } from '@/lib/palata-scan';
import { SCAN_STORE } from '@/lib/palata-ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?pinfl= → that client's signed ariza pages, extracted from the retained scan.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const pinfl = req.nextUrl.searchParams.get('pinfl');
  if (!pinfl) return NextResponse.json({ error: 'pinfl kerak' }, { status: 400 });

  const ariza = readScannedArizas().find((a) => a.pinfl === pinfl);
  if (!ariza || !ariza.source) return NextResponse.json({ error: 'Bu ariza uchun skan saqlanmagan' }, { status: 404 });
  const file = path.join(SCAN_STORE, path.basename(ariza.source));
  if (!fs.existsSync(file)) return NextResponse.json({ error: 'Skan fayli topilmadi' }, { status: 404 });

  const src = await PDFDocument.load(fs.readFileSync(file));
  const out = await PDFDocument.create();
  const count = src.getPageCount();
  const m = /^(\d+)-(\d+)$/.exec(ariza.pages || '');
  let idxs: number[];
  if (m) { const a = Math.max(1, Number(m[1])), b = Math.min(count, Number(m[2])); idxs = []; for (let p = a; p <= b; p++) idxs.push(p - 1); }
  else idxs = src.getPageIndices();
  const copied = await out.copyPages(src, idxs);
  copied.forEach((p) => out.addPage(p));
  const bytes = await out.save();

  const base = (ariza.name || pinfl).replace(/[^\p{L}\p{N} ._()-]+/gu, '_').trim().slice(0, 60) || pinfl;
  const ascii = `${base}.pdf`.replace(/[^\x20-\x7E]/g, '_');
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base + '.pdf')}`,
      'Cache-Control': 'no-store',
    },
  });
}
