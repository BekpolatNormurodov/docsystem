import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { reconcileZombieClients } from '@/lib/mib/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — bitta mijoz (ijro ishlari bilan). To'liq detal sahifasi va jonli yangilanish (tekshiruv
// ketayotganda) shu yerdan o'qiydi.
export async function GET(_req: NextRequest, { params }: { params: { cid: string } }) {
  await requireAccess('mib-report');
  const cid = Number(params.cid);
  if (!Number.isInteger(cid) || cid <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  let client = await prisma.mibClient.findUnique({ where: { id: cid }, include: { cases: { orderBy: { id: 'asc' } } } });
  if (!client) return NextResponse.json({ error: 'Mijoz topilmadi' }, { status: 404 });
  // Jarayon restart bo'lsa qotib qolgan RUNNING holatini tuzatamiz, so'ng qayta o'qiymiz.
  if (client.status === 'RUNNING') {
    const fixed = await reconcileZombieClients(client.reportId).catch(() => 0);
    if (fixed) client = await prisma.mibClient.findUnique({ where: { id: cid }, include: { cases: { orderBy: { id: 'asc' } } } }) ?? client;
  }
  return NextResponse.json({ client });
}
