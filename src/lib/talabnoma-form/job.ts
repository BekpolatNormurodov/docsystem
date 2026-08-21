// Background handlers for the «Talabnoma shakllantirish» module, dispatched from job-runner (inline in
// dev, on the Docker worker in prod). Two actions:
//   · parse           — read the 2 Excels → candidates.json, flip the batch READY with a summary.
//   · generate-letters — render one firm's PDF letters (+ reyestr) into a .zip for a history Run.
import fs from 'node:fs/promises';
import { prisma } from '@/lib/db';
import { parseTalabnomaForm, writeCandidates, readCandidates } from './parse';
import { buildRowsForFirm, firmLetterhead, writeLettersZip } from './generate';
import { candidatesJsonPath, batchDir, lettersZipPath } from './store';
import type { FilterOpts } from './types';

export async function runTalabnomaFormJob(jobId: number): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { params: true } });
  const p = (job?.params ?? {}) as Record<string, unknown>;
  const action = String(p.action ?? '');

  if (action === 'parse') {
    const batchId = Number(p.batchId);
    const batch = await prisma.talabnomaFormBatch.findUnique({ where: { id: batchId } });
    if (!batch) return void (await failJob(jobId, 'Batch topilmadi'));
    try {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } });
      // Estimate портфель row count from file size (~520 compressed bytes/row) so the UI can show a
      // real % while streaming. Persisted on the batch, so the progress survives a page reload / leave.
      const stat = await fs.stat(batch.portfolioPath).catch(() => null);
      const estRows = stat ? Math.max(1, Math.round(stat.size / 520)) : 0;
      await prisma.talabnomaFormBatch.update({ where: { id: batchId }, data: { totalRows: estRows, processedRows: 0 } });
      const { file, summary } = await parseTalabnomaForm(
        batch.sourcePath, batch.portfolioPath, batch.createdAt,
        async (rows) => {
          await prisma.talabnomaFormBatch.update({ where: { id: batchId }, data: { processedRows: rows } }).catch(() => {});
          await prisma.job.update({ where: { id: jobId }, data: { progress: rows, total: estRows } }).catch(() => {});
        },
      );
      await fs.mkdir(batchDir(batchId), { recursive: true });
      const cpath = candidatesJsonPath(batchId);
      await writeCandidates(cpath, file);
      await prisma.talabnomaFormBatch.update({
        where: { id: batchId },
        data: {
          status: 'READY',
          candidatesPath: cpath,
          candidateCount: summary.candidateCount,
          qualifiedCount: summary.qualifiedCount,
          summary: summary as any,
          message: null,
        },
      });
      await prisma.job.update({ where: { id: jobId }, data: { status: 'DONE', progress: 1, total: 1 } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.talabnomaFormBatch.update({ where: { id: batchId }, data: { status: 'FAILED', message: msg } }).catch(() => {});
      await failJob(jobId, msg);
    }
    return;
  }

  if (action === 'generate-letters') {
    const batchId = Number(p.batchId);
    const runId = Number(p.runId);
    const firmCode = String(p.firmCode ?? '');
    const opts = normalizeOpts(p.filters);
    try {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } });
      await prisma.talabnomaFormRun.update({ where: { id: runId }, data: { status: 'RUNNING' } });
      const batch = await prisma.talabnomaFormBatch.findUnique({ where: { id: batchId }, select: { candidatesPath: true } });
      if (!batch?.candidatesPath) throw new Error('Candidates topilmadi — batch tayyor emas');
      const file = await readCandidates(batch.candidatesPath);
      const rows = buildRowsForFirm(file, firmCode, opts);
      if (!rows.length) throw new Error('Tanlangan filtr uchun qator yo‘q');
      const firm = await firmLetterhead(firmCode);
      const zip = lettersZipPath(batchId, runId);
      await fs.mkdir(batchDir(batchId), { recursive: true });
      await writeLettersZip(rows, firm, zip);
      await prisma.talabnomaFormRun.update({
        where: { id: runId },
        data: { status: 'DONE', rowCount: rows.length, personCount: rows.length, resultPath: zip },
      });
      await prisma.job.update({ where: { id: jobId }, data: { status: 'DONE', progress: rows.length, total: rows.length } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.talabnomaFormRun.update({ where: { id: runId }, data: { status: 'FAILED', message: msg } }).catch(() => {});
      await failJob(jobId, msg);
    }
    return;
  }
}

function normalizeOpts(v: unknown): FilterOpts {
  const o = (v ?? {}) as Record<string, unknown>;
  const thresholdTotal = Number(o.thresholdTotal);
  const perFirmMin = Number(o.perFirmMin);
  return {
    thresholdTotal: Number.isFinite(thresholdTotal) && thresholdTotal >= 0 ? thresholdTotal : 2_000_000,
    perFirmMin: Number.isFinite(perFirmMin) && perFirmMin >= 0 ? perFirmMin : 0,
  };
}

async function failJob(jobId: number, message: string): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED', message } }).catch(() => {});
}
