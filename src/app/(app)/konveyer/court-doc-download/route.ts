import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredCabinetSession } from '@/lib/cabinet/session';
import { downloadCaseFile } from '@/lib/cabinet/api';

export const runtime = 'nodejs';
export const maxDuration = 60;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
const safe = (s: string) => (s || 'hujjat').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 60);

// GET ?caseId=&fileId=&name= — download one cabinet.sud.uz case document (ajrim/qaror/ariza) as a PDF.
// Resolves the firm's cabinet session from the case, fetches the file, unwraps the JSON envelope, and
// streams the PDF. Read-only.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  const fileId = req.nextUrl.searchParams.get('fileId');
  const name = req.nextUrl.searchParams.get('name') || 'Sud_hujjati';
  if (!Number.isInteger(caseId) || caseId <= 0 || !fileId) return NextResponse.json({ error: 'caseId va fileId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { kod: true } });
  const firm = ac?.kod ? await prisma.firm.findUnique({ where: { code: ac.kod }, select: { stir: true } }) : null;
  if (!firm?.stir) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  let session;
  try { session = await getStoredCabinetSession(digits(firm.stir)); }
  catch { return NextResponse.json({ error: 'Firma cabinet.sud.uz ga ulanmagan' }, { status: 409 }); }

  try {
    const { ok, status, buf } = await downloadCaseFile(session, fileId);
    if (!ok || buf.length < 100) return NextResponse.json({ error: `Hujjat yuklab boʻlmadi (${status})` }, { status: 502 });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent(`${safe(name)}.pdf`)}"`,
      },
    });
  } catch (e) {
    console.error('court-doc-download failed', e);
    return NextResponse.json({ error: 'Hujjat yuklab boʻlmadi' }, { status: 502 });
  }
}
