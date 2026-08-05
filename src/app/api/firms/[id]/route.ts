import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const data = await req.json();
  const firm = await prisma.firm.update({ where: { id: Number(params.id) }, data });
  return NextResponse.json(firm);
}
