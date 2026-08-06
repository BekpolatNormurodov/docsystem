import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const rec = await prisma.invoiceRecord.findUnique({ where: { id: Number(params.id) } });
  if (!rec || !rec.pdfPath) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const abs = path.join(process.cwd(), rec.pdfPath);
  if (!fs.existsSync(abs)) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const stat = fs.statSync(abs);
  const stream = fs.createReadStream(abs);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${rec.invoiceNo}-kvitansiya.pdf"`,
      'Content-Length': String(stat.size),
    },
  });
}
