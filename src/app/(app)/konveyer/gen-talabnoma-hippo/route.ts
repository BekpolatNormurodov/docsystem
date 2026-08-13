import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { downloadMailPdf } from '@/lib/hippo/xat';

export const runtime = 'nodejs';

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

// GET ?caseId= — the client's DELIVERED talabnoma LETTER PDF from xat.hippo (the letter hippo formed
// & delivered). Needs the firm connected AND the client's hippo mail already ingested (real uid).
// Best-effort: 404 with a clear message when there's no delivered mail yet.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { pinfl: true, kod: true, firmId: true } });
  if (!ac?.pinfl) return NextResponse.json({ error: 'Case maʼlumoti yoʻq' }, { status: 404 });

  // A real hippo mail uid for this client. Ingested rows store the uid in caseNumber; our own trace
  // rows use «TLB:…» — exclude those.
  const st = await prisma.clientCaseStatus.findFirst({
    where: {
      source: 'HIPPO', category: 'talabnoma', pinfl: ac.pinfl,
      ...(ac.kod ? { branchCode: ac.kod } : {}),
      caseNumber: { not: null },
      NOT: { caseNumber: { startsWith: 'TLB:' } },
    },
    orderBy: { updatedAt: 'desc' },
    select: { caseNumber: true },
  });
  if (!st?.caseNumber) return NextResponse.json({ error: 'xat.hippo da yetkazilgan talabnoma topilmadi (avval joʻnatish/ingest kerak)' }, { status: 404 });

  const firm = ac.firmId ? await prisma.firm.findUnique({ where: { id: ac.firmId }, select: { stir: true } }) : null;
  if (!firm?.stir) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  let session;
  try { session = await getStoredHippoSession(digits(firm.stir)); }
  catch { return NextResponse.json({ error: 'Firma xat.hippo ga ulanmagan' }, { status: 409 }); }

  try {
    const buf = await downloadMailPdf(session, st.caseNumber);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(`Talabnoma_hippo_${caseId}`)}.pdf"`,
      },
    });
  } catch (e) {
    console.error('gen-talabnoma-hippo failed', e);
    return NextResponse.json({ error: 'Yetkazilgan talabnoma yuklab boʻlmadi' }, { status: 502 });
  }
}
