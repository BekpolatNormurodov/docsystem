import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

// POST — STOP: clear autoRun. The runner loop checks this flag between clients and exits gracefully
// (the in-flight client finishes first, so no state is lost).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  await prisma.mibReport.update({ where: { id }, data: { autoRun: false } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
