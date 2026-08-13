import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';

const VALID_STAGES = new Set<string>(['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED']);

const numArg = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };

// GET ?snapshotId=&firmId=&stages= — cheap case count for the scope, so «Ariza yaratish» can show
// «Hammasi (N)» / the count modal before starting the (heavy) packet job.
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const snapshotId = numArg(sp.get('snapshotId'));
  const firmId = numArg(sp.get('firmId'));
  const stages = (sp.get('stages') || '').split(',').filter((s) => VALID_STAGES.has(s)) as CaseStage[];
  const where = {
    ...(snapshotId ? { snapshotId } : {}),
    ...(firmId ? { firmId } : {}),
    ...(stages.length ? { stage: { in: stages } } : {}),
  };
  const total = await prisma.arizaCase.count({ where });
  return NextResponse.json({ total });
}

// POST { snapshotId?, firmId?, stages?, talabnomaPdf? } — «Tayyorlash»: start a
// background job that builds the full packet for every case in scope into one ZIP.
// Returns { jobId, total }; the client polls /api/jobs/{jobId} and downloads
// /api/export/{jobId}/download when DONE.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));

  const num = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(body?.snapshotId);
  const firmId = num(body?.firmId);
  const stages = (Array.isArray(body?.stages) ? body.stages : []).filter((s: unknown) => typeof s === 'string' && VALID_STAGES.has(s)) as CaseStage[];
  const talabnomaPdf = body?.talabnomaPdf !== false;
  const limit = num(body?.limit);            // «belgilangan son» — build only the first N
  const arizaOnly = body?.arizaOnly === true; // «Arizani tayyorlash» — only the ariza per client

  // Require a narrowing scope so a stray body can't queue the whole table.
  if (snapshotId === undefined && firmId === undefined && stages.length === 0) {
    return NextResponse.json({ error: 'snapshotId yoki firmId/stages kerak' }, { status: 400 });
  }

  const where = {
    ...(snapshotId ? { snapshotId } : {}),
    ...(firmId ? { firmId } : {}),
    ...(stages.length ? { stage: { in: stages } } : {}),
  };
  const scopeTotal = await prisma.arizaCase.count({ where });
  if (scopeTotal === 0) return NextResponse.json({ error: 'Bu tanlovda case yoʻq' }, { status: 400 });
  // The job builds at most `limit` cases — reflect that in the reported/stored total.
  const total = limit && limit < scopeTotal ? limit : scopeTotal;

  const job = await prisma.job.create({
    data: { type: 'PACKET', status: 'PENDING', snapshotId: snapshotId ?? null, total, params: { snapshotId, firmId, stages, talabnomaPdf, limit, arizaOnly } },
  });

  // Run inline (default) or leave PENDING for the Docker worker (JOB_MODE=worker); the client polls the Job.
  enqueueJob(job.id);

  return NextResponse.json({ jobId: job.id, total });
}
