import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import { awaitJob } from '@/lib/await-job';

export const runtime = 'nodejs';
export const maxDuration = 300;

// GET ?caseId= — this client's talabnoma letter. The chromium HTML→PDF render now runs on the
// background worker: create a single-case TALABNOMA job (its reyestr .xlsx is skipped, so the ZIP is
// just the one letter), wait for it, then stream exports/{jobId}.zip. The job advances the talabnoma
// track (talabnomaAt) for this client, so no funnel write here.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: { pinfl: true, snapshotId: true, kod: true, clientName: true },
  });
  if (!ac?.pinfl || !ac.snapshotId) return NextResponse.json({ error: 'Case yoki mijoz maʼlumoti yoʻq' }, { status: 404 });

  // Letterhead firm resolved by branch code (as before); the job needs its numeric id to scope the batch.
  const firm = ac.kod ? await prisma.firm.findUnique({ where: { code: ac.kod }, select: { id: true } }) : null;
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  const job = await prisma.job.create({
    data: {
      type: 'TALABNOMA', status: 'PENDING', snapshotId: ac.snapshotId, total: 1,
      params: { snapshotId: ac.snapshotId, firmId: firm.id, pinfl: ac.pinfl, singleCase: true },
    },
  });
  enqueueJob(job.id);

  const r = await awaitJob(job.id);
  // FIX 3(a): a timeout means the job is still QUEUED (likely stuck behind a large bulk batch), not
  // failed — tell the user to retry once the batch clears rather than implying the document errored.
  if (r === 'TIMEOUT') return NextResponse.json({ error: 'Talabnoma navbatda — katta partiya tugagach qayta urinib koʻring' }, { status: 504 });
  if (r === 'FAILED') return NextResponse.json({ error: 'Talabnoma yaratilmadi' }, { status: 500 });

  const zipPath = path.join(process.cwd(), 'exports', `${job.id}.zip`);
  if (!fs.existsSync(zipPath)) return NextResponse.json({ error: 'Talabnoma yaratilmadi' }, { status: 500 });

  const safe = (ac.clientName || `case-${caseId}`).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  const stat = fs.statSync(zipPath);
  const stream = fs.createReadStream(zipPath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Talabnoma_${safe}`)}.zip"`,
      'Content-Length': String(stat.size),
    },
  });
}
