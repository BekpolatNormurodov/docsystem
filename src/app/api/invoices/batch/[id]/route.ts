import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getBatch } from '@/lib/invoice-automation';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const b = getBatch(params.id);
  if (!b) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  return NextResponse.json(b);
}
