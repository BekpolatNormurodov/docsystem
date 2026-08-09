import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { authenticateHippo } from '@/lib/hippo/session';
import { authenticateCabinet } from '@/lib/cabinet/session';

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
  // Selector to pick THIS firm's key from the E-IMZO store: try STIR, then name.
  const selector = account || firm.shortName;

  try {
    if (provider === 'HIPPO') {
      const s = await authenticateHippo(selector, account);
      return NextResponse.json({ ok: true, provider, account, keyCn: s.key.info.cn, org: s.key.info.org });
    } else {
      const s = await authenticateCabinet(selector, account);
      return NextResponse.json({ ok: true, provider, account, keyCn: s.key.info.cn, org: s.key.info.org });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'E-IMZO ulanmadi';
    console.error(`connect ${provider} firm ${firmId} failed:`, msg);
    // E-IMZO app not running / key not inserted / wrong key → clean 502, not 500.
    return NextResponse.json({ error: `Kalit ulanmadi: ${msg.slice(0, 160)}`, needsKey: true }, { status: 502 });
  }
}
