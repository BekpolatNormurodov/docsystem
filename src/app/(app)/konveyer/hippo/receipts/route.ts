import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { listReceiptRefs, downloadReceiptPdf } from '@/lib/hippo/xat';
import { performLabel } from '@/lib/hippo/mail-status';

export const runtime = 'nodejs';
export const maxDuration = 300;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
const safe = (s: string) => (s || 'kvitansiya').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 60);

// GET ?firmId=&registryId= — download the DELIVERED delivery-receipts (kvitansiya)
// of a hippo registry as one ZIP (court proof-of-delivery). Read-only. Capped to
// bound the request; ?all=1 also includes non-delivered (sent) receipts.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const firmId = Number(req.nextUrl.searchParams.get('firmId'));
  const registryId = req.nextUrl.searchParams.get('registryId');
  if (!firmId || !registryId) return NextResponse.json({ error: 'firmId va registryId kerak' }, { status: 400 });
  const includeAll = req.nextUrl.searchParams.get('all') === '1';
  const LIMIT = 120; // ~2.3s/receipt keeps the request under the 300s maxDuration

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { shortName: true, stir: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  let session;
  try { session = await getStoredHippoSession(digits(firm.stir)); }
  catch { return NextResponse.json({ error: 'Firma xat.hippo ga ulanmagan' }, { status: 409 }); }

  try {
    const refs = await listReceiptRefs(session, registryId);
    const wanted = refs.filter((r) => r.isSend && (includeAll || performLabel(r.performType).bucket === 'delivered'));
    if (wanted.length === 0) return NextResponse.json({ error: 'Yetkazilgan kvitansiya topilmadi' }, { status: 404 });
    const capped = wanted.slice(0, LIMIT);

    const zip = new JSZip();
    let ok = 0;
    for (const r of capped) {
      try {
        const buf = await downloadReceiptPdf(session, r.uid);
        zip.file(`${String(ok + 1).padStart(3, '0')}_${safe(r.receiverName || r.uid)}.pdf`, buf);
        ok += 1;
      } catch { /* skip a failed receipt */ }
    }
    if (ok === 0) return NextResponse.json({ error: 'Kvitansiyalar yuklab bo‘lmadi' }, { status: 502 });
    const out = await zip.generateAsync({ type: 'nodebuffer' });
    const name = `Kvitansiya_${safe(firm.shortName)}_reyestr-${registryId}`;
    return new NextResponse(new Uint8Array(out), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.zip"`,
        'X-Count': String(ok),
        'X-Dropped': String(wanted.length - ok),
      },
    });
  } catch (e) {
    console.error('hippo receipts failed', e);
    return NextResponse.json({ error: 'Kvitansiya yuklab bo‘lmadi' }, { status: 502 });
  }
}
