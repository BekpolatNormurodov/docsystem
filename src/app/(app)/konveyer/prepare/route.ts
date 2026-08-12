import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runPacketJob } from '@/lib/prepare-packets';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';

const VALID_STAGES = new Set<string>(['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED']);

// POST { snapshotId?, firmId?, stages?, talabnomaPdf? } — «Tayyorlash»: start a
// background job that builds the full packet for every case in scope into one ZIP.
// Returns { jobId, total }; the client polls /api/jobs/{jobId} and downloads
// /api/export/{jobId}/download when DONE.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));

  const num = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(body?.snapshotId);
  const firmId = num(body?.firmId);
  const stages = (Array.isArray(body?.stages) ? body.stages : []).filter((s: unknown) => typeof s === 'string' && VALID_STAGES.has(s)) as CaseStage[];
  const talabnomaPdf = body?.talabnomaPdf !== false;

  // Require a narrowing scope so a stray body can't queue the whole table.
  if (snapshotId === undefined && firmId === undefined && stages.length === 0) {
    return NextResponse.json({ error: 'snapshotId yoki firmId/stages kerak' }, { status: 400 });
  }

  const where = {
    ...(snapshotId ? { snapshotId } : {}),
    ...(firmId ? { firmId } : {}),
    ...(stages.length ? { stage: { in: stages } } : {}),
  };
  const total = await prisma.arizaCase.count({ where });
  if (total === 0) return NextResponse.json({ error: 'Bu tanlovda case yoʻq' }, { status: 400 });

  const job = await prisma.job.create({
    data: { type: 'PACKET', status: 'PENDING', snapshotId: snapshotId ?? null, total, params: { snapshotId, firmId, stages, talabnomaPdf } },
  });

  // Fire-and-forget: the server carries it to completion; the client polls the Job.
  void runPacketJob(job.id, { snapshotId, firmId, stages, talabnomaPdf }).catch(() => {});

  return NextResponse.json({ jobId: job.id, total });
}
