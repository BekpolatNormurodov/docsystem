import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getRestBatch, abortRestBatch } from '@/lib/invoice-rest';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const b = await getRestBatch(params.id);
  if (!b) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  return NextResponse.json(b);
}

// DELETE — «Bekor qilish»: stop a running invoice batch (the runner finalizes with what it made so far).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const ok = abortRestBatch(params.id);
  return NextResponse.json({ ok });
}
