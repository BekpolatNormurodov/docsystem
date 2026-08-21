import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { parseHisobot } from '@/lib/mib/parse';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST { statusFilter? } — (re)build the client queue from the saved HISOBOT, keeping only rows whose
// «Holat» equals statusFilter (empty = all). Replaces any existing clients for this report.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id }, select: { sourcePath: true, autoRun: true } });
  if (!report) return NextResponse.json({ error: 'Hisobot topilmadi' }, { status: 404 });
  if (report.autoRun) return NextResponse.json({ error: 'Avtomator ishlayapti — avval to‘xtating' }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const statusFilter = (String(body?.statusFilter ?? '').trim() || null) as string | null;

  const parsed = await parseHisobot(report.sourcePath);
  const rows = statusFilter ? parsed.rows.filter((r) => r.holat === statusFilter) : parsed.rows;

  await prisma.mibClient.deleteMany({ where: { reportId: id } });
  if (rows.length) {
    await prisma.mibClient.createMany({
      data: rows.map((r) => ({
        reportId: id, rowNo: r.rowNo, pinfl: r.pinfl, fio: r.fio, phone: r.phone, firm: r.firm,
        ishRaqami: r.ishRaqami, holat: r.holat, region: r.region, address: r.address, totalDebtSrc: r.totalDebtSrc,
      })),
    });
  }
  await prisma.mibReport.update({ where: { id }, data: { statusFilter, total: rows.length } });
  return NextResponse.json({ total: rows.length, statusFilter });
}
