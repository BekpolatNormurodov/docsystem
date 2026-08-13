import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { authenticateCabinet } from '@/lib/cabinet/session';
import { parsePickedKey } from '@/lib/hippo/eimzo';
import { eimzoMode } from '@/lib/eimzo-mode';
import type { ClientCert } from '@/lib/hippo/login';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 120;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

// POST { firmId, key } — the E-IMZO gate for «Sudga yuborish». Before a firm's
// court batch is released, the operator picks that firm's adolat (cabinet.sud.uz)
// key and enters its password (native E-IMZO dialog). A successful sign both proves
// the firm's key is present AND refreshes the stored adolat session. Only after this
// does CourtManager start the packet export. Guarded by the 'sud' step (admins pass).
export async function POST(req: NextRequest) {
  await requireStep('sud');
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { shortName: true, stir: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  const account = digits(firm.stir);
  if (!account) {
    return NextResponse.json({ error: 'Firmada STIR yoʻq — sudga yuborishdan oldin STIR kiriting' }, { status: 400 });
  }

  // CLIENT MODE: browser-signed challenge (adolat/cabinet). The cert is client-asserted
  // (untrusted) — pre-check is UX only; the real guard is the STIR reconciliation inside
  // authenticateCabinet (see src/lib/eimzo-verify.ts).
  const pkcs7 = typeof body?.pkcs7 === 'string' && body.pkcs7 ? (body.pkcs7 as string) : undefined;
  if (eimzoMode() === 'client' && pkcs7) {
    const cert = (body?.cert && typeof body.cert === 'object' ? body.cert : {}) as ClientCert;
    const certStir = (cert?.tin ?? '').replace(/\D+/g, '');
    if (certStir && certStir !== account) {
      return NextResponse.json({ error: `Tanlangan kalit boshqa firmaga tegishli (STIR ${certStir} ≠ ${account})` }, { status: 400 });
    }
    try {
      const s = await authenticateCabinet(undefined, account, { challengeId: String(body?.challengeId || ''), pkcs7, cert });
      await audit(AuditAction.CONNECT, { target: `firm:${firmId}`, detail: { provider: 'CABINET', account, purpose: 'court-sign', mode: 'client' } });
      return NextResponse.json({ ok: true, provider: 'CABINET', account, keyCn: s.key.info.cn, org: s.key.info.org });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'E-IMZO imzo qoʻyilmadi';
      console.error(`court-sign(client) firm ${firmId} failed:`, msg);
      return NextResponse.json({ error: `Kalit imzolanmadi: ${msg.slice(0, 200)}`, needsKey: true }, { status: 502 });
    }
  }

  // Explicitly-chosen key (from the picker) or the firm's STIR selector as fallback.
  const picked = parsePickedKey(body?.key);
  // The chosen key MUST be this firm's legal-entity key: its cert STIR has to exist AND
  // equal the firm's. A TIN-less (individual) key or another firm's key would sign the
  // court batch as the wrong entity — require a positive match (empty STIR fails).
  const keyStir = (picked?.info.tin ?? '').replace(/\D+/g, '');
  if (picked && keyStir !== account) {
    return NextResponse.json(
      { error: keyStir ? `Tanlangan kalit boshqa firmaga tegishli (STIR ${keyStir} ≠ ${account})` : `Tanlangan kalitda firma STIRi yoʻq — ${firm.shortName} (yuridik shaxs) kalitini tanlang` },
      { status: 400 },
    );
  }
  const selector = picked ?? account;

  try {
    const s = await authenticateCabinet(selector, account);
    await audit(AuditAction.CONNECT, { target: `firm:${firmId}`, detail: { provider: 'CABINET', account, purpose: 'court-sign' } });
    return NextResponse.json({ ok: true, provider: 'CABINET', account, keyCn: s.key.info.cn, org: s.key.info.org });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'E-IMZO imzo qoʻyilmadi';
    console.error(`court-sign firm ${firmId} failed:`, msg);
    return NextResponse.json({ error: `Kalit imzolanmadi: ${msg.slice(0, 200)}`, needsKey: true }, { status: 502 });
  }
}
