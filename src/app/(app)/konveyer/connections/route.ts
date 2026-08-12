import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { hippoCall } from '@/lib/hippo/session';
import { cabinetCall } from '@/lib/cabinet/session';
import type { ExtProvider, ExtSessionStatus } from '@prisma/client';

export const runtime = 'nodejs';

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
type State = 'ACTIVE' | 'EXPIRED' | 'NONE';
// Mirror isFresh(): a session past its expiry (5-min skew) is EXPIRED even if the
// status column still says ACTIVE (nothing re-pinged it since), so the fast view
// doesn't show a dead token as green.
const stateFrom = (s: ExtSessionStatus | undefined, expiresAt: Date | null): State =>
  (s === 'ACTIVE' && (!expiresAt || expiresAt.getTime() - 300_000 > Date.now())) ? 'ACTIVE' : 'EXPIRED';

interface ProvInfo { state: State; since: string | null; expiresAt: string | null; balance?: number | null; name?: string | null }

// GET               → per-firm hippo/cabinet status + session timestamps (fast, DB).
// GET ?health=1     → additionally live-pings each ACTIVE session (hippo balance,
//                     cabinet user) to confirm the token still works, right now.
// GET ?health=1&firmId= → ping just one firm.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const health = req.nextUrl.searchParams.get('health') === '1';
  const firmIdParam = req.nextUrl.searchParams.get('firmId');

  const [firms, sessions] = await Promise.all([
    prisma.firm.findMany({ select: { id: true, shortName: true, stir: true } }),
    prisma.externalSession.findMany({ select: { provider: true, account: true, status: true, updatedAt: true, expiresAt: true } }),
  ]);
  // account is bare digits; Firm.stir has spaces — normalize both.
  const byAcct = new Map<string, Partial<Record<ExtProvider, ProvInfo>>>();
  for (const s of sessions) {
    const key = digits(s.account);
    const rec = byAcct.get(key) ?? {};
    rec[s.provider] = { state: stateFrom(s.status, s.expiresAt), since: s.updatedAt.toISOString(), expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null };
    byAcct.set(key, rec);
  }
  const none: ProvInfo = { state: 'NONE', since: null, expiresAt: null };
  const rows = firms.map((f) => {
    const rec = byAcct.get(digits(f.stir)) ?? {};
    return { firmId: f.id, firmName: f.shortName, stir: f.stir, hippo: rec.HIPPO ?? { ...none }, cabinet: rec.CABINET ?? { ...none } };
  });

  const checkedAt = new Date().toISOString();
  if (!health) return NextResponse.json({ checkedAt, firms: rows });

  const targets = firmIdParam ? rows.filter((r) => r.firmId === Number(firmIdParam)) : rows;
  await Promise.all(
    targets.map(async (r) => {
      const acct = digits(r.stir);
      if (r.hippo.state === 'ACTIVE') {
        try {
          const res = await hippoCall(acct, '/billing/my-balance');
          const j: any = await res.json().catch(() => null);
          r.hippo.balance = j?.data?.balance ?? j?.balance ?? null;
          r.hippo.name = j?.data?.name ?? j?.name ?? null;
          if (!res.ok) r.hippo.state = 'EXPIRED';
        } catch { r.hippo.state = 'EXPIRED'; }
      }
      if (r.cabinet.state === 'ACTIVE') {
        try {
          const res = await cabinetCall(acct, '/api/cabinet/user/get');
          if (!res.ok) r.cabinet.state = 'EXPIRED';
          else { const j: any = await res.json().catch(() => null); r.cabinet.name = j?.data?.fullName ?? j?.data?.name ?? null; }
        } catch { r.cabinet.state = 'EXPIRED'; }
      }
    }),
  );
  return NextResponse.json({ checkedAt: new Date().toISOString(), firms: targets });
}
