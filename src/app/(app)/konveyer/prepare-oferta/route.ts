import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';

const VALID_STAGES = new Set<string>(['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED']);

// POST { snapshotId?, firmId?, stages?, insurancePct? } — «Oferta»: start a background job
// that renders ONLY the ofertas (one PDF per contract) for every case in scope into one ZIP
// grouped by client. Returns { jobId, total }; poll /api/jobs/{jobId}, download
// /api/export/{jobId}/download when DONE.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));

  const num = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(body?.snapshotId);
  const firmId = num(body?.firmId);
  const stages = (Array.isArray(body?.stages) ? body.stages : []).filter((s: unknown) => typeof s === 'string' && VALID_STAGES.has(s)) as CaseStage[];
  const insP = Number(body?.insurancePct);
  const insurancePct = Number.isFinite(insP) && insP >= 0 && insP <= 100 ? insP : 0;

  // courtList mode: every contract of every court-bound client (distinct PINFL across the
  // snapshot's arizaCases), across ALL firms — the «1054 mijoz» full oferta run.
  if (body?.courtList === true && snapshotId) {
    const cases = await prisma.arizaCase.findMany({ where: { snapshotId, ...(firmId ? { firmId } : {}) }, select: { pinfl: true }, distinct: ['pinfl'] });
    const pinfls = cases.map((c) => c.pinfl).filter((p): p is string => !!p);
    if (!pinfls.length) return NextResponse.json({ error: 'Court list boʻsh' }, { status: 400 });
    const loans = await prisma.loan.findMany({ where: { snapshotId, pinfl: { in: pinfls }, summKr: { gt: 0 } }, select: { id: true } });
    const ids = loans.map((l) => l.id);
    // Store snapshotId/firmId (not the thousands of loan ids) so the worker recomputes the same set.
    const job = await prisma.job.create({
      data: { type: 'OFERTA', status: 'PENDING', snapshotId, total: ids.length, params: { courtList: true, snapshotId, firmId, clients: pinfls.length, insurancePct } },
    });
    enqueueJob(job.id);
    return NextResponse.json({ jobId: job.id, total: ids.length, clients: pinfls.length });
  }

  // loanIds mode: render a hand-picked set of contracts (loan-level), grouped by client.
  const loanIds = (Array.isArray(body?.loanIds) ? body.loanIds : [])
    .map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0);
  if (loanIds.length) {
    // Persist the actual loan ids (a hand-picked subset, so small) so the worker renders the same set.
    const job = await prisma.job.create({
      data: { type: 'OFERTA', status: 'PENDING', snapshotId: snapshotId ?? null, total: loanIds.length, params: { loanIds, insurancePct } },
    });
    enqueueJob(job.id);
    return NextResponse.json({ jobId: job.id, total: loanIds.length });
  }

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
    data: { type: 'OFERTA', status: 'PENDING', snapshotId: snapshotId ?? null, total, params: { snapshotId, firmId, stages, insurancePct } },
  });

  // Run inline (default) or leave PENDING for the Docker worker (JOB_MODE=worker).
  enqueueJob(job.id);

  return NextResponse.json({ jobId: job.id, total });
}
