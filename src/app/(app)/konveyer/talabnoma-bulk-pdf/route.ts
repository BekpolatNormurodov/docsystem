import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';

export const runtime = 'nodejs';

// POST { snapshotId, firmId } — «Talabnoma PDF»: start a background job that renders one talabnoma
// letter per client for the whole firm (one snapshot) into a single ZIP (with the reyestr .xlsx at
// the root). Returns { jobId, total }; the client polls /api/jobs/{jobId} and downloads
// /api/export/{jobId}/download when DONE. Per-firm because a hippo reyestr is per-firm.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const num = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(body?.snapshotId);
  const firmId = num(body?.firmId);
  if (!snapshotId || !firmId) return NextResponse.json({ error: 'snapshotId va firmId kerak' }, { status: 400 });

  // Cheap upper-bound count for the job's initial `total` (progress bar). The job overwrites it with
  // the exact rendered count when it finishes (zero-debt clients drop out inside the loader).
  const total = await prisma.arizaCase.count({ where: { snapshotId, firmId } });
  if (total === 0) return NextResponse.json({ error: 'Bu firmada case yoʻq' }, { status: 400 });

  const job = await prisma.job.create({
    data: { type: 'TALABNOMA', status: 'PENDING', snapshotId, total, params: { snapshotId, firmId } },
  });

  // Run inline (default) or leave PENDING for the Docker worker (JOB_MODE=worker).
  enqueueJob(job.id);

  return NextResponse.json({ jobId: job.id, total });
}
