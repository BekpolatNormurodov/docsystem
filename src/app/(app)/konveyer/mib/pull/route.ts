import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { mibEligibleCases } from '@/lib/konveyer';

export const runtime = 'nodejs';

// The MIB enforcement pool for a firm/snapshot: cases the court ruled in our
// favor (COURT_ACCEPTED) + already-at-MIB (MIB_SUBMITTED). The client streams a
// SIMULATED "2-API pull" over these — the real MIB APIs aren't wired yet.
// GET /konveyer/mib/pull?firmId=1&s=3
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const num = (raw: string | null): number | undefined => {
    const n = Number(raw);
    return raw != null && raw !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const data = await mibEligibleCases({ firmId: num(sp.get('firmId')), snapshotId: num(sp.get('s')) });
  return NextResponse.json(data);
}
