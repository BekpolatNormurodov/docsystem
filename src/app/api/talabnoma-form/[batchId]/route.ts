import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { batchDir } from '@/lib/talabnoma-form/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — one batch + its runs. Used to poll parse status and refresh the history after a run.
export async function GET(_req: NextRequest, { params }: { params: { batchId: string } }) {
  await requireAdmin();
  const id = Number(params.batchId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'batchId noto‘g‘ri' }, { status: 400 });
  const batch = await prisma.talabnomaFormBatch.findUnique({
    where: { id },
    include: { runs: { orderBy: { id: 'desc' } } },
  });
  if (!batch) return NextResponse.json({ error: 'Batch topilmadi' }, { status: 404 });
  return NextResponse.json({ batch });
}

// DELETE — remove a batch from history: DB row (runs cascade) + its whole folder on disk (both Excels,
// candidates.json, generated reyestr/zip). The UI confirms with a modal before calling this.
export async function DELETE(_req: NextRequest, { params }: { params: { batchId: string } }) {
  await requireAdmin();
  const id = Number(params.batchId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'batchId noto‘g‘ri' }, { status: 400 });
  const batch = await prisma.talabnomaFormBatch.findUnique({ where: { id }, select: { id: true } });
  if (!batch) return NextResponse.json({ error: 'Batch topilmadi' }, { status: 404 });
  await prisma.talabnomaFormBatch.delete({ where: { id } });
  await fs.rm(batchDir(id), { recursive: true, force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
