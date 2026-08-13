import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { cabinetChallenge } from '@/lib/cabinet/oneid';

export const runtime = 'nodejs';
export const maxDuration = 60;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

// POST { firmId, provider } — CLIENT-MODE step 1 for cabinet.sud.uz. The SERVER mints the
// OneID token_id + (cookie-bound) challenge and stashes that context under a random
// challengeId; the browser then signs the returned `challenge` on the USER's machine and
// posts { challengeId, pkcs7 } back to /konveyer/connect (or /konveyer/court-sign).
// HIPPO needs no challenge (it signs a fixed constant), so this only handles CABINET.
//
// Guarded by requireStep('sud'): admins (who connect) AND sud-yurists (who court-sign)
// both pass it, and both flows need a challenge. Minting is not itself sensitive —
// consuming the challenge still requires a valid PKCS7 from the firm's key.
export async function POST(req: NextRequest) {
  await requireStep('sud');
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  const provider = String(body?.provider || 'CABINET').toUpperCase();
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { shortName: true, stir: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  const account = digits(firm.stir);
  if (!account) return NextResponse.json({ error: 'Firmada STIR yoʻq — avval STIR kiriting' }, { status: 400 });

  // HIPPO: no server challenge — the browser signs the fixed constant directly.
  if (provider !== 'CABINET') {
    return NextResponse.json({ ok: true, provider, noChallenge: true });
  }

  try {
    // tin = the firm's STIR (server-derived) — used for the legal-entity sso generate step.
    const { challengeId, challenge } = await cabinetChallenge({ tin: account });
    return NextResponse.json({ ok: true, challengeId, challenge });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Challenge olinmadi';
    console.error(`cabinet challenge firm ${firmId} failed:`, msg);
    return NextResponse.json({ error: `Challenge olinmadi: ${msg.slice(0, 200)}` }, { status: 502 });
  }
}
