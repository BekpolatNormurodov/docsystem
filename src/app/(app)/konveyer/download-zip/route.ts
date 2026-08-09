import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// GET ?caseId= — download all of a case's uploaded documents as one ZIP.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!caseId) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: { clientName: true, documents: { select: { kind: true, fileName: true, filePath: true } } },
  });
  if (!ac) return NextResponse.json({ error: 'Case topilmadi' }, { status: 404 });
  if (ac.documents.length === 0) return NextResponse.json({ error: 'Yuklangan hujjat yo‘q' }, { status: 404 });

  const zip = new JSZip();
  for (const d of ac.documents) {
    try {
      const buf = await fs.readFile(d.filePath);
      zip.file(`${d.kind}__${d.fileName}`, buf);
    } catch { /* skip missing file */ }
  }
  const out = await zip.generateAsync({ type: 'nodebuffer' });
  const safe = (ac.clientName || `case-${caseId}`).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return new NextResponse(new Uint8Array(out), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Paket_${safe}.zip`)}"`,
    },
  });
}
