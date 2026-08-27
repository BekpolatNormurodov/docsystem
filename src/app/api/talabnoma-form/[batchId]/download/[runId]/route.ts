import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';

export const runtime = 'nodejs';

// GET — stream a saved run output (reyestr .xlsx or letters .zip) from disk for the history view.
export async function GET(_req: NextRequest, { params }: { params: { batchId: string; runId: string } }) {
  await requireAccess('talabnoma-form');
  const runId = Number(params.runId);
  if (!Number.isInteger(runId) || runId <= 0) return NextResponse.json({ error: 'runId noto‘g‘ri' }, { status: 400 });

  const run = await prisma.talabnomaFormRun.findUnique({ where: { id: runId } });
  if (!run || run.batchId !== Number(params.batchId)) return NextResponse.json({ error: 'Run topilmadi' }, { status: 404 });
  if (run.status !== 'DONE' || !run.resultPath || !fs.existsSync(run.resultPath)) {
    return NextResponse.json({ error: 'Fayl tayyor emas' }, { status: 409 });
  }

  const ext = path.extname(run.resultPath).toLowerCase();
  const isZip = ext === '.zip';
  const base = `${(run.firmName || run.firmCode || 'talabnoma').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}_${run.kind}${ext}`;
  const stat = fs.statSync(run.resultPath);
  const stream = fs.createReadStream(run.resultPath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': isZip ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(base)}"`,
      'Content-Length': String(stat.size),
    },
  });
}
