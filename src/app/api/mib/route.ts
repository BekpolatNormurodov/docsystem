import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — list reports (newest first) with per-status client counts for the history sidebar.
export async function GET() {
  await requireAdmin();
  const reports = await prisma.mibReport.findMany({ orderBy: { id: 'desc' } });
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
