import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — list reports (newest first) with per-status client counts for the history sidebar.
// Konveyerdan urug'langan reportlar (sourceFileName «konveyer:…») bu ro'yxatda ko'rinmaydi — ular
// konveyer MIB bosqichida turadi, standalone modul esa alohida (foydalanuvchi so'rovi).
export async function GET() {
  await requireAccess('mib-report');
  const reports = await prisma.mibReport.findMany({
    where: { NOT: { sourceFileName: { startsWith: 'konveyer:' } } },
    orderBy: { id: 'desc' },
  });
  const counts = await prisma.mibClient.groupBy({ by: ['reportId', 'status'], _count: { _all: true } });
  const byReport = new Map<number, Record<string, number>>();
  for (const c of counts) {
    const m = byReport.get(c.reportId) ?? {};
    m[c.status] = c._count._all;
    byReport.set(c.reportId, m);
  }
  return NextResponse.json({
    reports: reports.map((r) => ({ ...r, statusCounts: byReport.get(r.id) ?? {} })),
  });
}
