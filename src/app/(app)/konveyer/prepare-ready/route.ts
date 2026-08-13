import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { konveyerSnapshots } from '@/lib/konveyer';
import { enqueueJob } from '@/lib/job-dispatch';
import { selectReadyCaseIds, validateSelectedCaseIds } from '@/lib/court-ready';

export const runtime = 'nodejs';

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined;
};

// POST { firmId, snapshotId?, limit?, includeExported?, talabnomaPdf? } —
// «Sudga chiqarish»: build the FULL ready packet (talabnoma+ariza+skan-slot+oferta
// +boji, NO grafik) for up to `limit` (max 100) fully-ready, not-yet-exported cases
// of ONE firm, into one ZIP, and stamp them exported. Returns { jobId, total }.
export async function POST(req: NextRequest) {
  // Match the read routes + the /sud page guard — the side-effectful export must
  // not be reachable by a user who has no 'sud' step grant.
  await requireStep('sud');
  const body = await req.json().catch(() => ({}));

  const firmId = num(body?.firmId);
  if (!firmId) return NextResponse.json({ error: 'firmId kerak (har firma alohida chiqariladi)' }, { status: 400 });
  // Resolve snapshot like the GET routes (validate against real snapshots, else latest)
  // so a missing/invalid snapshotId never runs downstream queries with NO snapshot filter.
  const snaps = await konveyerSnapshots();
  const rawSnap = num(body?.snapshotId);
  const snapshotId = rawSnap && snaps.some((s) => s.id === rawSnap) ? rawSnap : snaps[0]?.id;
  const limit = Math.min(100, Math.max(1, num(body?.limit) ?? 100));
  const includeExported = body?.includeExported === true;
  const talabnomaPdf = body?.talabnomaPdf !== false;

  // Optional hand-picked subset from the drill-down (server RE-VALIDATES every id —
  // a stale client selection can never smuggle a non-ready case into the ZIP);
  // otherwise auto-pick the oldest-due ready-and-not-exported cases.
  // Distinct, capped selection (Prisma `in` collapses duplicates, so dedupe first
  // to keep the `skipped` count honest).
  const uniqIds = Array.isArray(body?.caseIds)
    ? [...new Set((body.caseIds as unknown[]).map(Number).filter((x): x is number => Number.isInteger(x) && x > 0))].slice(0, 100)
    : null;
  const caseIds = uniqIds?.length
    ? await validateSelectedCaseIds({ snapshotId, firmId, caseIds: uniqIds, includeExported })
    : await selectReadyCaseIds({ snapshotId, firmId, limit, includeExported });
  if (caseIds.length === 0) {
    return NextResponse.json(
      { error: includeExported ? 'Chiqarish uchun tayyor mijoz yoʻq' : 'Yuborishga tayyor (chiqarilmagan) mijoz yoʻq' },
      { status: 400 },
    );
  }
  const skipped = uniqIds ? uniqIds.length - caseIds.length : 0;

  // Store the FULL packet options (grafik yoʻq, mark exported) so the worker reconstructs the job
  // identically to the inline path — not just the case ids.
  const job = await prisma.job.create({
    data: {
      type: 'PACKET', status: 'PENDING', snapshotId: snapshotId ?? null, total: caseIds.length,
      params: { firmId, snapshotId, caseIds, ready: true, talabnomaPdf, includeGrafik: false, markExported: true },
    },
  });

  // Run inline (default) or leave PENDING for the Docker worker (JOB_MODE=worker).
  enqueueJob(job.id);

  // `skipped` is additive — existing callers read only jobId/total.
  return NextResponse.json({ jobId: job.id, total: caseIds.length, skipped });
}
