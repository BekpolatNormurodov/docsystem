import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { syncCasesFromSnapshot } from '@/lib/konveyer';

export const runtime = 'nodejs';

// Seed/refresh ArizaCase rows from the latest (or given) READY snapshot's
// court-list clients. Idempotent — safe to call repeatedly.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const snapshotId = body?.snapshotId ? Number(body.snapshotId) : undefined;
  try {
    const result = await syncCasesFromSnapshot(snapshotId);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'sync xatosi' }, { status: 400 });
  }
}
