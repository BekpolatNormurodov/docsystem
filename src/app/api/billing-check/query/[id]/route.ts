import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';

// DELETE — bitta tarix (qidiruv) yozuvini o'chiradi. Keshdagi kvitansiyalarga tegmaydi.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('invoice-check');
  const t = getT();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: t('id noto‘g‘ri') }, { status: 400 });
  const row = await prisma.billingCheckQuery.findUnique({ where: { id }, select: { id: true } });
  if (!row) return NextResponse.json({ error: t('Topilmadi') }, { status: 404 });
  await prisma.billingCheckQuery.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
