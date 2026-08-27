import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { ingestHippoStatuses } from '@/lib/hippo/status-ingest';
import { liveRegistryIds } from '@/lib/hippo/xat';
import { reconcileTraceAgainstLive } from '@/lib/hippo/talabnoma-trace';

export const runtime = 'nodejs';
export const maxDuration = 300;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

// POST { firmId } — «Hippodan sinxronlash»: pull the firm's EXISTING xat.hippo reyestrs + mails
// (including the ones the lawyers uploaded manually) into ClientCaseStatus, matched by name → PINFL.
// This is what lets the talabnoma «iz»/dedupe know a client was already sent, so it isn't re-sent.
// Read from hippo, write only status rows — no talabnoma is dispatched.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { code: true, stir: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });
  if (!firm.code) return NextResponse.json({ error: 'Firma kodi yoʻq' }, { status: 422 });

  let session;
  try { session = await getStoredHippoSession(digits(firm.stir)); }
  catch { return NextResponse.json({ error: 'Firma xat.hippo ga ulanmagan' }, { status: 409 }); }

  try {
    const result = await ingestHippoStatuses(session, firm.code);
    // Also self-heal the «iz»: drop trace rows pointing at reyestrs that no longer exist on hippo.
    let pruned = 0;
    try { pruned = await reconcileTraceAgainstLive(firm.code, await liveRegistryIds(session)); }
    catch (e) { console.error('reconcileTraceAgainstLive (sync) failed', e); }
    return NextResponse.json({ ok: true, ...result, pruned });
  } catch (e) {
    console.error('hippo sync failed', e);
    return NextResponse.json({ error: 'Sinxronlab boʻlmadi' }, { status: 502 });
  }
}
