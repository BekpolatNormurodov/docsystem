import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadInvoicePdf } from '@/lib/invoice-rest';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET ?caseId= — the state-fee invoice (kvitansiya) PDF. Prefers the copy captured when the invoice
// was minted (InvoiceRecord.pdfPath); if that's missing but a billing invoice number exists, it
// live-fetches from billing.sud.uz (GET /api/invoice/asDocument?invoice=<no>) and caches it under
// storage/invoices/. Reference/download only — it does NOT go into the court packet (the ariza stays
// davlat-bojisiz).
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const [rec, ac] = await Promise.all([
    prisma.invoiceRecord.findFirst({ where: { caseId }, orderBy: { id: 'desc' }, select: { invoiceNo: true, pdfPath: true } }),
    prisma.arizaCase.findUnique({ where: { id: caseId }, select: { invoiceNo: true, receiptNumber: true } }),
  ]);
  // Prefer the REAL billing number (InvoiceRecord / ArizaCase.invoiceNo); receiptNumber is the fallback.
  const invoiceNo = rec?.invoiceNo || ac?.invoiceNo || ac?.receiptNumber || null;
  if (!invoiceNo) return NextResponse.json({ error: 'Invoice hali yaratilmagan (Invoice yaratish bosqichida)' }, { status: 409 });

  // 1) Cached copy captured at mint — fastest.
  let abs = rec?.pdfPath ? path.join(process.cwd(), rec.pdfPath) : null;
  // 2) Otherwise pull it live from billing.sud.uz (asDocument) and cache it for next time.
  if (!abs || !fs.existsSync(abs)) {
    try {
      const rel = await downloadInvoicePdf(String(invoiceNo));
      abs = path.join(process.cwd(), rel);
    } catch (e) {
      console.error('invoice-pdf live fetch failed', e);
      return NextResponse.json({ error: `billing.sud.uz dan yuklab boʻlmadi (invoice ${invoiceNo})` }, { status: 502 });
    }
  }
  if (!abs || !fs.existsSync(abs)) return NextResponse.json({ error: 'PDF topilmadi' }, { status: 404 });

  const stat = fs.statSync(abs);
  const stream = fs.createReadStream(abs);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoiceNo}-kvitansiya.pdf"`,
      'Content-Length': String(stat.size),
    },
  });
}
