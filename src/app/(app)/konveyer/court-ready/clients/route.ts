import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { firmReadyClients } from '@/lib/court-ready';

export const runtime = 'nodejs';

const num = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

// GET ?firmId=&s= — per-firm client drill-down (4-doc checklist per case): ALL rows + counts in one
// shot. The drill-down filters/searches/paginates client-side, so this fires ONCE per drill-down open
// (or firm/snapshot change), not on every filter/search/page — that per-interaction refetch was slow.
export async function GET(req: NextRequest) {
  await requireStep('sud');
  const raw = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = num(raw);
  // Cheap snapshot resolution — this route fires on every filter/search/page change, so
  // avoid the full-table konveyerSnapshots() groupBy: validate the passed id with an indexed
  // lookup (@@index([snapshotId])), else fall back to the latest snapshot that has cases.
  let snapshotId: number | undefined;
  if (parsed) {
    const hit = await prisma.arizaCase.findFirst({ where: { snapshotId: parsed }, select: { snapshotId: true } });
    snapshotId = hit?.snapshotId ?? undefined;
  }
  if (snapshotId == null) {
    const latest = await prisma.arizaCase.findFirst({ where: { snapshotId: { not: null } }, orderBy: { snapshotId: 'desc' }, select: { snapshotId: true } });
    snapshotId = latest?.snapshotId ?? undefined;
  }

  const firmId = num(req.nextUrl.searchParams.get('firmId'));
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });

  const result = await firmReadyClients({ snapshotId, firmId });
  return NextResponse.json(result);
}
