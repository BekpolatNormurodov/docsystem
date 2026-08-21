import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { buildMibExcel } from '@/lib/mib/excel';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET — download the full report as .xlsx (Mijozlar + Ishlar sheets, all Step 19 detail).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: 'Hisobot topilmadi' }, { status: 404 });
  const clients = await prisma.mibClient.findMany({ where: { reportId: id }, orderBy: { id: 'asc' }, include: { cases: true } });

  const buf = await buildMibExcel(report, clients);
  const name = `MIB_${(report.label || report.sourceFileName).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}.xlsx`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
      'Content-Length': String(buf.length),
    },
  });
}
