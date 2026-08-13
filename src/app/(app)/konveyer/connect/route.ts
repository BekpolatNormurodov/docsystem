import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { authenticateHippo } from '@/lib/hippo/session';
import { authenticateCabinet } from '@/lib/cabinet/session';
import { parsePickedKey } from '@/lib/hippo/eimzo';
import { eimzoMode } from '@/lib/eimzo-mode';
import type { ClientCert } from '@/lib/hippo/login';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 120;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

// POST { firmId, provider: 'HIPPO' | 'CABINET' } — connect a firm's E-IMZO key.
// This triggers the native E-IMZO password dialog on the machine running the
// server, so it only succeeds with the key inserted and the user present. The
// resulting token is stored (ExternalSession) keyed by the firm's STIR.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  const provider = String(body?.provider || '').toUpperCase();
  if (!firmId || (provider !== 'HIPPO' && provider !== 'CABINET')) {
    return NextResponse.json({ error: 'firmId va provider (HIPPO|CABINET) kerak' }, { status: 400 });
  }

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { shortName: true, stir: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  const account = digits(firm.stir);
  // A firm with no STIR would store its session under the empty account key ('') and COLLIDE with
  // every other STIR-less firm on the unique (provider,'') ExternalSession row — silently inheriting
  // another firm's real cabinet/hippo identity. Refuse until the firm has a STIR.
  if (!account) {
    return NextResponse.json({ error: 'Firmada STIR yoʻq — ulanishdan oldin STIR kiriting' }, { status: 400 });
  }

  // CLIENT MODE: the browser already produced the PKCS7 on the USER's local E-IMZO. The
  // server never scans a local cert, so the cert here is CLIENT-ASSERTED (untrusted) — the
  // pre-check below is UX only; the authoritative identity guard is the STIR reconciliation
  // inside authenticateHippo/authenticateCabinet (see src/lib/eimzo-verify.ts).
  const pkcs7 = typeof body?.pkcs7 === 'string' && body.pkcs7 ? (body.pkcs7 as string) : undefined;
  if (eimzoMode() === 'client' && pkcs7) {
    const cert = (body?.cert && typeof body.cert === 'object' ? body.cert : {}) as ClientCert;
    const certStir = digits(cert?.tin);
    // UX pre-filter (the authoritative gate is Fix A's reconciliation): a MISSING/empty
    // client cert.tin must NOT bypass — require it present AND equal to the firm STIR.
    if (!certStir || certStir !== account) {
      return NextResponse.json({ error: certStir ? `Tanlangan kalit boshqa firmaga tegishli (STIR ${certStir} ≠ ${account})` : `Tanlangan kalitda firma STIRi yoʻq — ${firm.shortName} (yuridik shaxs) kalitini tanlang` }, { status: 400 });
    }
    try {
      const s = provider === 'HIPPO'
        ? await authenticateHippo(undefined, account, { pkcs7, cert })
        : await authenticateCabinet(undefined, account, { challengeId: String(body?.challengeId || ''), pkcs7, cert });
      const verified = s.verified === true;
      await audit(AuditAction.CONNECT, { target: `firm:${firmId}`, detail: { provider, account, mode: 'client', verified } });
      return NextResponse.json({ ok: true, provider, account, verified, keyCn: s.key.info.cn, org: s.key.info.org });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'E-IMZO ulanmadi';
      console.error(`connect(client) ${provider} firm ${firmId} failed:`, msg);
      return NextResponse.json({ error: `Kalit ulanmadi: ${msg.slice(0, 200)}`, needsKey: true }, { status: 502 });
    }
  }

  // Prefer the key the operator explicitly chose in the picker ({disk,path,name,alias});
  // this bypasses the fragile STIR auto-match (cert TIN ≠ firm STIR → no dialog) and
  // guarantees the E-IMZO password prompt runs for the selected key. Falls back to the
  // firm's STIR selector when no key was passed (legacy / programmatic connect).
  const picked = parsePickedKey(body?.key);
  // Safeguard: a chosen key MUST be this firm's legal-entity key — its cert STIR has to
  // exist AND equal the firm's. A TIN-less (individual/ID-card) key or another firm's key
  // would authenticate the WRONG identity but store the session under THIS firm's account.
  // Require a positive match (empty STIR fails, not passes).
  const keyStir = (picked?.info.tin ?? '').replace(/\D+/g, '');
  if (picked && keyStir !== account) {
    return NextResponse.json(
      { error: keyStir ? `Tanlangan kalit boshqa firmaga tegishli (STIR ${keyStir} ≠ ${account})` : `Tanlangan kalitda firma STIRi yoʻq — ${firm.shortName} (yuridik shaxs) kalitini tanlang` },
      { status: 400 },
    );
  }
  const selector = picked ?? account;

  try {
    if (provider === 'HIPPO') {
      const s = await authenticateHippo(selector, account);
      await audit(AuditAction.CONNECT, { target: `firm:${firmId}`, detail: { provider, account } });
      return NextResponse.json({ ok: true, provider, account, keyCn: s.key.info.cn, org: s.key.info.org });
    } else {
      const s = await authenticateCabinet(selector, account);
      await audit(AuditAction.CONNECT, { target: `firm:${firmId}`, detail: { provider, account } });
      return NextResponse.json({ ok: true, provider, account, keyCn: s.key.info.cn, org: s.key.info.org });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'E-IMZO ulanmadi';
    console.error(`connect ${provider} firm ${firmId} failed:`, msg);
    // E-IMZO app not running / key not inserted / wrong key → clean 502, not 500.
    return NextResponse.json({ error: `Kalit ulanmadi: ${msg.slice(0, 160)}`, needsKey: true }, { status: 502 });
  }
}
