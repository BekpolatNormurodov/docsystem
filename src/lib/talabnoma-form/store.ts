// Disk layout for the standalone «Talabnoma shakllantirish» module. Every batch keeps its two
// uploaded Excels + the reduced candidates.json + generated outputs under one folder, named by the
// batch id — the DB row only stores the paths (as the operator asked: «db da static file save bo'lib
// path qoladi»). Mirrors the inline path.join(process.cwd(), ...) convention used across the app.
import path from 'node:path';

export const TF_ROOT = path.join(process.cwd(), 'storage', 'talabnoma-forms');

export const batchDir = (batchId: number) => path.join(TF_ROOT, String(batchId));
export const sourceXlsxPath = (batchId: number) => path.join(batchDir(batchId), 'source.xlsx');
export const portfolioXlsxPath = (batchId: number) => path.join(batchDir(batchId), 'portfolio.xlsx');
export const candidatesJsonPath = (batchId: number) => path.join(batchDir(batchId), 'candidates.json');
export const reyestrXlsxPath = (batchId: number, runId: number) =>
  path.join(batchDir(batchId), `run-${runId}-reyestr.xlsx`);
export const lettersZipPath = (batchId: number, runId: number) =>
  path.join(batchDir(batchId), `run-${runId}-letters.zip`);
