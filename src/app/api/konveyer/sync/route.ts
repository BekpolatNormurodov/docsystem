import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { syncCasesFromSnapshot } from '@/lib/konveyer';

export const runtime = 'nodejs';

// Seed/refresh ArizaCase rows from the latest (or given) READY snapshot's
// court-list clients. Idempotent — safe to call repeatedly.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  // A malformed snapshotId must 400, not silently coerce to NaN (falsy) and sync
  // the LATEST snapshot instead of the requested one.
  let snapshotId: number | undefined;
  if (body?.snapshotId != null && body.snapshotId !== '') {
    const n = Number(body.snapshotId);
    if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: 'snapshotId notoʻgʻri' }, { status: 400 });
    snapshotId = n;
  }
  try {
    const result = await syncCasesFromSnapshot(snapshotId);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'sync xatosi' }, { status: 400 });
  }
}
