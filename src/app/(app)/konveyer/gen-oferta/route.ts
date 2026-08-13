import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import { awaitJob } from '@/lib/await-job';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Person-folder name, byte-identical to buildCaseOfertas' `folder`, so the download keeps its name.
const safe = (s: string, n = 70) => (s || 'hujjat').replace(/[^\p{L}\p{N}._ ()'ʻ‘’-]+/gu, '_').trim().slice(0, n) || 'hujjat';

// GET ?caseId= — the client's ofertas as a ZIP (one oferta PDF per loan contract). The HTML→PDF
// chromium render now runs on the background worker: create an OFERTA job scoped to this case, wait
// for it, then stream exports/{jobId}.zip. Per-case sibling of the bulk «prepare-oferta» job.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { snapshotId: true, clientName: true } });
  if (!ac?.snapshotId) return NextResponse.json({ error: 'Case maʼlumoti yoʻq' }, { status: 404 });

  const job = await prisma.job.create({
    data: { type: 'OFERTA', status: 'PENDING', snapshotId: ac.snapshotId, total: 1, params: { caseIds: [caseId], insurancePct: 0 } },
  });
  enqueueJob(job.id);

  const r = await awaitJob(job.id);
  // FIX 3(a): a timeout means the job is still QUEUED (likely stuck behind a large bulk batch), not
  // failed — tell the user to retry once the batch clears rather than implying the document errored.
  if (r === 'TIMEOUT') return NextResponse.json({ error: 'Oferta navbatda — katta partiya tugagach qayta urinib koʻring' }, { status: 504 });
  if (r === 'FAILED') return NextResponse.json({ error: 'Oferta yaratilmadi' }, { status: 500 });

  // FIX 3(b): the job can finish DONE yet produce ZERO ofertas (e.g. a case whose loans have no
  // qualifying contract) — streaming that empty ZIP looks like a silent success. runOfertaJob records
  // the produced oferta count as the leading number of its DONE `message` (`"<n> oferta / <m> case"`),
  // the only Job-row field that reflects documents (progress/total count cases, not docs). Zero → 404.
  const done = await prisma.job.findUnique({ where: { id: job.id }, select: { message: true } });
  const ofertaCount = Number(done?.message?.match(/^(\d+)\s+oferta/)?.[1] ?? NaN);
  if (ofertaCount === 0) return NextResponse.json({ error: 'Hujjat topilmadi' }, { status: 404 });

  const zipPath = path.join(process.cwd(), 'exports', `${job.id}.zip`);
  if (!fs.existsSync(zipPath)) return NextResponse.json({ error: 'Oferta yaratilmadi' }, { status: 500 });

  const folder = safe(ac.clientName || `case-${caseId}`);
  const safeName = (folder || `case-${caseId}`).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 60);
  const stat = fs.statSync(zipPath);
  const stream = fs.createReadStream(zipPath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Oferta_${safeName}`)}.zip"`,
      'Content-Length': String(stat.size),
    },
  });
}
