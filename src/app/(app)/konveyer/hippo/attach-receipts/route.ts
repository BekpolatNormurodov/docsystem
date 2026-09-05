import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { attachTalabnomaReceipts } from '@/lib/hippo/attach-receipts';

export const runtime = 'nodejs';
export const maxDuration = 300;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

// POST { firmId } — «Kvitansiyalarni biriktirish»: bulk-download the firm's talabnoma UZPOST
// receipts (checks) from xat.hippo and attach each to its case (CaseDocument TALABNOMA_RECEIPT).
// Bounded per call (downloads are ~2s each); idempotent — re-run until remaining=0. The hippo SYNC
// also runs this automatically so newly-sent talabnomas get their check attached going forward.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, code: true, stir: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  let session;
  try { session = await getStoredHippoSession(digits(firm.stir)); }
  catch { return NextResponse.json({ error: 'Firma xat.hippo ga ulanmagan' }, { status: 409 }); }

  try {
    const r = await attachTalabnomaReceipts(session, { id: firm.id, code: firm.code }, { limit: 100 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error('attach-receipts failed', e);
    return NextResponse.json({ error: 'Kvitansiyalarni biriktirib boʻlmadi' }, { status: 502 });
  }
}
