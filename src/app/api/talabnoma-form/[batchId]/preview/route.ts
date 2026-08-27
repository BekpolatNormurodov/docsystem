import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { readCandidates } from '@/lib/talabnoma-form/parse';
import { evaluate, DEFAULT_THRESHOLD } from '@/lib/talabnoma-form/filter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST { thresholdTotal, perFirmMin } — live counts for the two-stage filter modal, WITHOUT generating
// anything. Returns per-firm buckets (ready flag), qualified/ready/unready people.
export async function POST(req: NextRequest, { params }: { params: { batchId: string } }) {
  await requireAccess('talabnoma-form');
  const id = Number(params.batchId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'batchId noto‘g‘ri' }, { status: 400 });

  const batch = await prisma.talabnomaFormBatch.findUnique({ where: { id }, select: { candidatesPath: true, status: true } });
  if (!batch) return NextResponse.json({ error: 'Batch topilmadi' }, { status: 404 });
  if (batch.status !== 'READY' || !batch.candidatesPath) {
    return NextResponse.json({ error: 'Batch hali tayyor emas' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const thresholdTotal = numOr(body?.thresholdTotal, DEFAULT_THRESHOLD);
  const perFirmMin = numOr(body?.perFirmMin, 0);

  const file = await readCandidates(batch.candidatesPath);
  const result = evaluate(file, { thresholdTotal, perFirmMin });
  return NextResponse.json({ result, opts: { thresholdTotal, perFirmMin } });
}

function numOr(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}
