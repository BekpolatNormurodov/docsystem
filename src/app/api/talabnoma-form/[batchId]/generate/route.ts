import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { enqueueJob } from '@/lib/job-dispatch';
import { readCandidates } from '@/lib/talabnoma-form/parse';
import { buildRowsForFirm, writeReyestr } from '@/lib/talabnoma-form/generate';
import { isReadyFirm, DEFAULT_THRESHOLD } from '@/lib/talabnoma-form/filter';
import { reyestrXlsxPath } from '@/lib/talabnoma-form/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST { firmCode, firmName?, kind: 'REYESTR'|'LETTERS', thresholdTotal, perFirmMin, includeUnready }
//  · a non-ready firm (∉ Bright/Urban/Community) is BLOCKED unless includeUnready:true → the client
//    shows the «qolgani ketsinmi?» confirm first (returns 409 needsConfirm otherwise).
//  · REYESTR is built inline (fast); LETTERS goes to a background job (chromium PDF).
export async function POST(req: NextRequest, { params }: { params: { batchId: string } }) {
  const user = await requireAccess('talabnoma-form');
  const id = Number(params.batchId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'batchId noto‘g‘ri' }, { status: 400 });

  const batch = await prisma.talabnomaFormBatch.findUnique({ where: { id }, select: { candidatesPath: true, status: true } });
  if (!batch) return NextResponse.json({ error: 'Batch topilmadi' }, { status: 404 });
  if (batch.status !== 'READY' || !batch.candidatesPath) return NextResponse.json({ error: 'Batch tayyor emas' }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const firmCode = String(body?.firmCode ?? '').trim();
  if (!firmCode) return NextResponse.json({ error: 'firmCode majburiy' }, { status: 400 });
  const kind = body?.kind === 'LETTERS' ? 'LETTERS' : 'REYESTR';
  const thresholdTotal = numOr(body?.thresholdTotal, DEFAULT_THRESHOLD);
  const perFirmMin = numOr(body?.perFirmMin, 0);
  const includeUnready = body?.includeUnready === true;
  const opts = { thresholdTotal, perFirmMin };

  const ready = isReadyFirm(firmCode);
  if (!ready && !includeUnready) {
    return NextResponse.json(
      { needsConfirm: true, error: 'Bu firma to‘liq forma tayyor emas — tasdiqlang' },
      { status: 409 },
    );
  }

  const firmName = String(body?.firmName ?? '') || firmCode;
  const filters = { thresholdTotal, perFirmMin, includeUnready };

  if (kind === 'REYESTR') {
    const file = await readCandidates(batch.candidatesPath);
    const rows = buildRowsForFirm(file, firmCode, opts);
    if (!rows.length) return NextResponse.json({ error: 'Tanlangan filtr uchun qator yo‘q' }, { status: 422 });
    const run = await prisma.talabnomaFormRun.create({
      data: { batchId: id, createdBy: user.username, kind: 'REYESTR', firmCode, firmName, filters, status: 'RUNNING' },
    });
    const outPath = reyestrXlsxPath(id, run.id);
    await writeReyestr(rows, outPath);
    await prisma.talabnomaFormRun.update({
      where: { id: run.id },
      data: { status: 'DONE', rowCount: rows.length, personCount: rows.length, resultPath: outPath },
    });
    return NextResponse.json({ runId: run.id, rowCount: rows.length, kind: 'REYESTR' });
  }

  // LETTERS — background job.
  const run = await prisma.talabnomaFormRun.create({
    data: { batchId: id, createdBy: user.username, kind: 'LETTERS', firmCode, firmName, filters, status: 'PENDING' },
  });
  const job = await prisma.job.create({
    data: {
      type: 'TALABNOMA_FORM',
      status: 'PENDING',
      params: { action: 'generate-letters', batchId: id, runId: run.id, firmCode, filters: opts },
    },
  });
  enqueueJob(job.id);
  return NextResponse.json({ runId: run.id, jobId: job.id, kind: 'LETTERS' });
}

function numOr(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}
