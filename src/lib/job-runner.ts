// Reconstruct + run a background Job from its persisted `type` + `params`. ONE source of truth used
// by BOTH the inline dispatcher (default, JOB_MODE unset — the web process runs it) and the Docker
// worker (JOB_MODE=worker — a separate process claims + runs it). A job therefore runs identically
// whichever process executes it. IMPORT stays on its own route (temp-file bound); the worker skips it.
import { prisma } from './db';
import { runPacketJob, runOfertaJob, runOfertaJobByLoans, runTalabnomaJob, type PacketJobOpts, type OfertaJobOpts } from './prepare-packets';
import { runTalabnomaFormJob } from './talabnoma-form/job';
import { runMibReportJob } from './mib/run';
import type { CaseStage } from '@prisma/client';

const intArr = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((x) => Number.isInteger(x) && x > 0) : []);

export async function runJobById(jobId: number): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, type: true, params: true } });
  if (!job) return;
  const p = (job.params ?? {}) as Record<string, unknown>;

  if (job.type === 'PACKET') {
    const opts: PacketJobOpts = {
      snapshotId: p.snapshotId != null ? Number(p.snapshotId) : undefined,
      firmId: p.firmId != null ? Number(p.firmId) : undefined,
      stages: Array.isArray(p.stages) ? (p.stages as CaseStage[]) : undefined,
      caseIds: intArr(p.caseIds).length ? intArr(p.caseIds) : undefined,
      talabnomaPdf: p.talabnomaPdf as boolean | undefined,
      includeGrafik: p.includeGrafik as boolean | undefined,
      markExported: p.markExported === true,
      limit: p.limit != null ? Number(p.limit) : undefined,
      arizaOnly: p.arizaOnly === true,
    };
    await runPacketJob(jobId, opts);
    return;
  }

  if (job.type === 'OFERTA') {
    const insurancePct = Number(p.insurancePct) || 0;
    const loanIds = intArr(p.loanIds);
    const caseIds = intArr(p.caseIds);
    if (loanIds.length) {
      await runOfertaJobByLoans(jobId, loanIds, insurancePct);
    } else if (p.courtList === true && p.snapshotId != null) {
      const ids = await courtListLoanIds(Number(p.snapshotId), p.firmId != null ? Number(p.firmId) : undefined);
      await runOfertaJobByLoans(jobId, ids, insurancePct);
    } else if (caseIds.length) {
      await runOfertaJob(jobId, { caseIds, insurancePct });
    } else {
      const opts: OfertaJobOpts = {
        snapshotId: p.snapshotId != null ? Number(p.snapshotId) : undefined,
        firmId: p.firmId != null ? Number(p.firmId) : undefined,
        stages: Array.isArray(p.stages) ? (p.stages as CaseStage[]) : undefined,
        insurancePct,
        limit: p.limit != null ? Number(p.limit) : undefined,
      };
      await runOfertaJob(jobId, opts);
    }
    return;
  }

  if (job.type === 'TALABNOMA') {
    if (p.snapshotId != null && p.firmId != null) {
      await runTalabnomaJob(
        jobId,
        { snapshotId: Number(p.snapshotId), firmId: Number(p.firmId), pinfl: p.pinfl as string | undefined },
        p.singleCase === true,
      );
    }
    return;
  }

  if (job.type === 'TALABNOMA_FORM') {
    await runTalabnomaFormJob(jobId);
    return;
  }

  if (job.type === 'MIB_RUN') {
    await runMibReportJob(jobId);
    return;
  }
  // IMPORT + unknown types: run by their own route (inline). The worker leaves them for the web process.
}

// courtList oferta: every contract (summKr>0 loan) of every distinct court-bound client — recomputed
// from params so the loan-id list needn't be persisted (it can be thousands).
async function courtListLoanIds(snapshotId: number, firmId?: number): Promise<number[]> {
  const cases = await prisma.arizaCase.findMany({ where: { snapshotId, ...(firmId ? { firmId } : {}) }, select: { pinfl: true }, distinct: ['pinfl'] });
  const pinfls = cases.map((c) => c.pinfl).filter((p): p is string => !!p);
  if (!pinfls.length) return [];
  const loans = await prisma.loan.findMany({ where: { snapshotId, pinfl: { in: pinfls }, summKr: { gt: 0 } }, select: { id: true } });
  return loans.map((l) => l.id);
}
