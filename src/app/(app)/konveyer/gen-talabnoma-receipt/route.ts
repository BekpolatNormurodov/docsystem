import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { downloadReceiptPdf } from '@/lib/hippo/xat';

export const runtime = 'nodejs';

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

// GET ?caseId= — the client's talabnoma KVITANSIYA (UZPOST «check») PDF from xat.hippo.
// This is the 1-page postal dispatch receipt (Ягона миллий тизим … квитанция, TD-raqam) that must
// accompany the ariza to court. Sibling of gen-talabnoma-hippo (which fetches the LETTER); this one
// hits /perform/receipt/{uid} instead of /mail/{uid}/download — both keyed by the same mail uid
// stored in ClientCaseStatus.caseNumber (populated by the hippo sync/ingest). Best-effort: a clear
// 404 when the client's hippo mail hasn't been ingested yet.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { pinfl: true, kod: true, firmId: true } });
  if (!ac?.pinfl) return NextResponse.json({ error: 'Case maʼlumoti yoʻq' }, { status: 404 });

  // Real hippo mail uid for this client (ingested rows store the uid in caseNumber; our own
  // trace rows use «TLB:…» — exclude those).
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
  if (!st?.caseNumber) return NextResponse.json({ error: 'xat.hippo da talabnoma kvitansiyasi topilmadi (avval joʻnatish/sync kerak)' }, { status: 404 });

  const firm = ac.firmId ? await prisma.firm.findUnique({ where: { id: ac.firmId }, select: { stir: true } }) : null;
  if (!firm?.stir) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  let session;
  try { session = await getStoredHippoSession(digits(firm.stir)); }
  catch { return NextResponse.json({ error: 'Firma xat.hippo ga ulanmagan' }, { status: 409 }); }

  try {
    const buf = await downloadReceiptPdf(session, st.caseNumber);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(`Talabnoma_kvitansiya_${caseId}`)}.pdf"`,
      },
    });
  } catch (e) {
    console.error('gen-talabnoma-receipt failed', e);
    return NextResponse.json({ error: 'Kvitansiya yuklab boʻlmadi' }, { status: 502 });
  }
}
