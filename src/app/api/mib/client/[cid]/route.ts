import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { reconcileZombieClients, isMibRunActive } from '@/lib/mib/run';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — bitta mijoz (ijro ishlari bilan). To'liq detal sahifasi va jonli yangilanish (tekshiruv
// ketayotganda) shu yerdan o'qiydi.
export async function GET(req: NextRequest, { params }: { params: { cid: string } }) {
  await requireAccess('mib-report');
  const t = getT();
  const cid = Number(params.cid);
  if (!Number.isInteger(cid) || cid <= 0) return NextResponse.json({ error: t('id noto‘g‘ri') }, { status: 400 });
  // ?archived=1 → arxivlangan (eski qayta tekshirish) nusxalar bilan; default — faqat faol ishlar.
  const withArchived = req.nextUrl.searchParams.get('archived') === '1';
  const casesInclude = { orderBy: { id: 'asc' as const }, ...(withArchived ? {} : { where: { archivedAt: null } }) };
  let client = await prisma.mibClient.findUnique({ where: { id: cid }, include: { cases: casesInclude } });
  if (!client) return NextResponse.json({ error: t('Mijoz topilmadi') }, { status: 404 });
  // Jarayon restart bo'lsa qotib qolgan RUNNING holatini tuzatamiz, so'ng qayta o'qiymiz.
  if (client.status === 'RUNNING') {
    const fixed = await reconcileZombieClients(client.reportId).catch(() => 0);
    if (fixed) client = await prisma.mibClient.findUnique({ where: { id: cid }, include: { cases: casesInclude } }) ?? client;
  }
  // Arxiv soni — UI toggle uchun (archived=0 rejimида ham hisoblanadi).
  const archivedCount = withArchived ? 0 : await prisma.mibCase.count({ where: { clientId: cid, archivedAt: { not: null } } });
  return NextResponse.json({ client, running: isMibRunActive(client.reportId), archivedCount });
}
