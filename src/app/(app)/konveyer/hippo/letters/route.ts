import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { listReceiptRefs, downloadMailPdf } from '@/lib/hippo/xat';

export const runtime = 'nodejs';
export const maxDuration = 300;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
const safe = (s: string) => (s || 'talabnoma').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 60);

// GET ?firmId=&registryId= — download the SENT talabnoma LETTER PDFs (the letters hippo formed
// from the reyestr) of one registry as a single ZIP. Distinct from ?…/receipts (that is the
// delivery kvitansiya). Read-only. Capped to bound the request under maxDuration.
export async function GET(req: NextRequest) {
  await requireUser();
  const firmId = Number(req.nextUrl.searchParams.get('firmId'));
  const registryId = req.nextUrl.searchParams.get('registryId');
  if (!firmId || !registryId) return NextResponse.json({ error: 'firmId va registryId kerak' }, { status: 400 });
  const LIMIT = 120; // ~2.3s/letter keeps the request under the 300s maxDuration

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { shortName: true, stir: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  let session;
  try { session = await getStoredHippoSession(digits(firm.stir)); }
  catch { return NextResponse.json({ error: 'Firma xat.hippo ga ulanmagan' }, { status: 409 }); }

  try {
    const refs = await listReceiptRefs(session, registryId);
    const wanted = refs.filter((r) => r.isSend); // letters that were actually formed/sent
    if (wanted.length === 0) return NextResponse.json({ error: 'Yuborilgan talabnoma topilmadi' }, { status: 404 });
    const capped = wanted.slice(0, LIMIT);

    const zip = new JSZip();
    let ok = 0;
    for (const r of capped) {
      try {
        const buf = await downloadMailPdf(session, r.uid);
        zip.file(`${String(ok + 1).padStart(3, '0')}_${safe(r.receiverName || r.uid)}.pdf`, buf);
        ok += 1;
      } catch { /* skip a failed letter */ }
    }
    if (ok === 0) return NextResponse.json({ error: 'Talabnomalar yuklab boʻlmadi' }, { status: 502 });
    const out = await zip.generateAsync({ type: 'nodebuffer' });
    const name = `Talabnoma_${safe(firm.shortName)}_reyestr-${registryId}`;
    return new NextResponse(new Uint8Array(out), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.zip"`,
        'X-Count': String(ok),
        'X-Dropped': String(wanted.length - ok),
      },
    });
  } catch (e) {
    console.error('hippo letters failed', e);
    return NextResponse.json({ error: 'Talabnomalar yuklab boʻlmadi' }, { status: 502 });
  }
}
