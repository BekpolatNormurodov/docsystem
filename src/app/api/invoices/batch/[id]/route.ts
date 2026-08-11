import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getRestBatch } from '@/lib/invoice-rest';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const b = getRestBatch(params.id);
  if (!b) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  return NextResponse.json(b);
}
