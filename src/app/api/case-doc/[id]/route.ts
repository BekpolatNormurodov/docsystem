import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export const runtime = 'nodejs';

// Bitta case hujjatini (CaseDocument) fayl sifatida oqim bilan beradi. Mijoz sahifasidagi
// «Shakllangan hujjatlar» ro'yxati shu route orqali yuklab oladi/ochadi.
const TYPE_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const doc = await prisma.caseDocument.findUnique({ where: { id } });
  if (!doc || !doc.filePath) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const abs = path.isAbsolute(doc.filePath) ? doc.filePath : path.join(process.cwd(), doc.filePath);
  if (!fs.existsSync(abs)) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const stat = fs.statSync(abs);
  const ext = path.extname(doc.fileName || abs).toLowerCase();
  const stream = fs.createReadStream(abs);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': TYPE_BY_EXT[ext] ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.fileName || `hujjat-${id}`)}"`,
      'Content-Length': String(stat.size),
    },
  });
}
