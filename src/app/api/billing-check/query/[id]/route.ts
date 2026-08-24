import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// DELETE — bitta tarix (qidiruv) yozuvini o'chiradi. Keshdagi kvitansiyalarga tegmaydi.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const row = await prisma.billingCheckQuery.findUnique({ where: { id }, select: { id: true } });
  if (!row) return NextResponse.json({ error: 'Topilmadi' }, { status: 404 });
  await prisma.billingCheckQuery.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
