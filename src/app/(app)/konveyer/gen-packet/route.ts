import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import { awaitJob } from '@/lib/await-job';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Person-folder name, byte-identical to buildCasePacket's `folder`, so the download keeps its name
// even though the packet itself is now built off-process by the worker.
const safe = (s: string, n = 70) => (s || 'hujjat').replace(/[^\p{L}\p{N}._ ()'ʻ‘’-]+/gu, '_').trim().slice(0, n) || 'hujjat';

// Count entries in a store-mode ZIP by reading only its End-Of-Central-Directory record. archiver
// writes no ZIP comment, so the EOCD is the final 22 bytes; the 16-bit field at offset 10 is the total
// entry count. Cheap (22-byte tail read regardless of archive size) and exact for the empty (0-entry)
// case. Returns -1 when the tail isn't a bare EOCD (unexpected) so the caller treats it as "unknown"
// and does NOT wrongly block a real download.
async function zipEntryCount(zipPath: string): Promise<number> {
  const fh = await fs.promises.open(zipPath, 'r');
  try {
    const { size } = await fh.stat();
    if (size < 22) return 0;
    const buf = Buffer.alloc(22);
    await fh.read(buf, 0, 22, size - 22);
    if (buf.readUInt32LE(0) !== 0x06054b50) return -1; // EOCD signature "PK\x05\x06" not at the tail
    return buf.readUInt16LE(10);
  } finally {
    await fh.close();
  }
}

// GET ?caseId= — one-click FULL packet for a single case, streamed as a ZIP. The heavy chromium work
// runs on the background worker (JOB_MODE=worker) or inline (default): create a PACKET job scoped to
// this case, wait for it to finish, then stream exports/{jobId}.zip.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { snapshotId: true, clientName: true } });
  if (!ac?.snapshotId) return NextResponse.json({ error: 'Case yoki portfel maʼlumoti yoʻq' }, { status: 404 });

  const job = await prisma.job.create({
    data: { type: 'PACKET', status: 'PENDING', snapshotId: ac.snapshotId, total: 1, params: { caseIds: [caseId], talabnomaPdf: true } },
  });
  enqueueJob(job.id);

  const r = await awaitJob(job.id);
  // FIX 3(a): a timeout means the job is still QUEUED (likely stuck behind a large bulk batch), not
  // failed — tell the user to retry once the batch clears rather than implying the document errored.
  if (r === 'TIMEOUT') return NextResponse.json({ error: 'Paket navbatda — katta partiya tugagach qayta urinib koʻring' }, { status: 504 });
  if (r === 'FAILED') return NextResponse.json({ error: 'Paket yaratilmadi' }, { status: 500 });

  const zipPath = path.join(process.cwd(), 'exports', `${job.id}.zip`);
  if (!fs.existsSync(zipPath)) return NextResponse.json({ error: 'Paket yaratilmadi' }, { status: 500 });

  // FIX 3(b): a packet job can finish DONE yet produce ZERO documents (buildCasePacket yielded no files
  // → no client folder, no firm docs). runPacketJob keeps no doc-count on the Job row (progress/total
  // count cases, no message), so read the finished ZIP's entry count cheaply instead. Zero → 404 rather
  // than streaming an empty archive as success.
  if ((await zipEntryCount(zipPath)) === 0) return NextResponse.json({ error: 'Hujjat topilmadi' }, { status: 404 });

  // The job already advanced the case (prepare-packets → markPacketGenerated), so no funnel write here.
  await audit(AuditAction.PACKET_GEN, { target: `case:${caseId}` });
  const folder = safe(ac.clientName || `case-${caseId}`);
  const stat = fs.statSync(zipPath);
  const stream = fs.createReadStream(zipPath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(folder)}.zip"`,
      'Content-Length': String(stat.size),
    },
  });
}
