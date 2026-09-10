import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { computeStats } from '@/lib/mib/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — UMUMIY: barcha hisobotlardagi mijozlar birga (bitta statistika + kesim). Bir PINFL bir necha
// hisobotда bo'lsa — DUBLIKAT sanalmasin uchun PINFL bo'yicha eng to'la (ko'p ishli / eng oxirgi
// tekshirilgan) yozuv olinadi. Dashboard buni /api/mib/[id] o'rniga o'qiydi (aggregate rejimi).
export async function GET(_req: NextRequest) {
  await requireAccess('mib-report');
  const all = await prisma.mibClient.findMany({ orderBy: { id: 'asc' }, include: { cases: { orderBy: { id: 'asc' } } } });

  const byPinfl = new Map<string, (typeof all)[number]>();
  for (const c of all) {
    const ex = byPinfl.get(c.pinfl);
    const better = !ex
      || c.cases.length > ex.cases.length
      || (c.cases.length === ex.cases.length && (c.checkedAt?.getTime() ?? 0) > (ex.checkedAt?.getTime() ?? 0));
    if (better) byPinfl.set(c.pinfl, c);
  }
  const clients = [...byPinfl.values()];
  const stats = computeStats(clients);
  const report = { id: 0, createdAt: new Date().toISOString(), label: 'Umumiy', sourceFileName: 'aggregate', statusFilter: null, total: clients.length, autoRun: false, runJobId: null };
  return NextResponse.json({ report, clients, stats, holatValues: [], sentDateRange: { min: null, max: null } });
}
