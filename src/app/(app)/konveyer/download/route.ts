import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// GET ?id= — stream an uploaded case document as a download.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'id kerak' }, { status: 400 });
  const doc = await prisma.caseDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'Topilmadi' }, { status: 404 });
  let buf: Buffer;
  try { buf = await fs.readFile(doc.filePath); } catch { return NextResponse.json({ error: 'Fayl yo‘q' }, { status: 404 }); }
  const ext = path.extname(doc.fileName).toLowerCase();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
      'Content-Length': String(buf.length),
    },
  });
}
