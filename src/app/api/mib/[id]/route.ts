import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { computeStats } from '@/lib/mib/stats';
import { parseHisobot } from '@/lib/mib/parse';
import { mibReportDir } from '@/lib/mib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — one report with its clients (+cases) and computed monitoring statistics.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: 'Hisobot topilmadi' }, { status: 404 });
  const clients = await prisma.mibClient.findMany({ where: { reportId: id }, orderBy: { id: 'asc' }, include: { cases: true } });
  const stats = computeStats(clients);
  // «Holat» filter options — re-parsed from the source only when idle (the filter can't change mid-run).
  let holatValues: { value: string; count: number }[] = [];
  if (!report.autoRun && report.sourcePath) {
    holatValues = await parseHisobot(report.sourcePath).then((r) => r.holatValues).catch(() => []);
  }
  return NextResponse.json({ report, clients, stats, holatValues });
}

// DELETE — remove a report (clients/cases cascade) + its folder.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id }, select: { autoRun: true } });
  if (!report) return NextResponse.json({ error: 'Hisobot topilmadi' }, { status: 404 });
  if (report.autoRun) return NextResponse.json({ error: 'Avtomator ishlayapti — avval to‘xtating' }, { status: 409 });
  await prisma.mibReport.delete({ where: { id } });
  await fs.rm(mibReportDir(id), { recursive: true, force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
