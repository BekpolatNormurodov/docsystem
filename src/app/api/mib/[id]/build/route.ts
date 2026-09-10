import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { parseHisobot } from '@/lib/mib/parse';
import { MANUAL_HOLAT } from '@/lib/mib/run';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST { statusFilter? } — (re)build the client queue from the saved HISOBOT, keeping only rows whose
// «Holat» equals statusFilter (empty = all). Replaces any existing clients for this report.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id }, select: { sourcePath: true, autoRun: true } });
  if (!report) return NextResponse.json({ error: 'Hisobot topilmadi' }, { status: 404 });
  if (report.autoRun) return NextResponse.json({ error: 'Avtomator ishlayapti — avval to‘xtating' }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const statusFilter = (String(body?.statusFilter ?? '').trim() || null) as string | null;
  const dateFrom = (String(body?.dateFrom ?? '').trim() || null) as string | null; // YYYY-MM-DD
  const dateTo = (String(body?.dateTo ?? '').trim() || null) as string | null;

  const parsed = await parseHisobot(report.sourcePath);
  const rows = parsed.rows.filter((r) => {
    if (statusFilter && r.holat !== statusFilter) return false;
    if (dateFrom && (!r.sentDate || r.sentDate < dateFrom)) return false;
    if (dateTo && (!r.sentDate || r.sentDate > dateTo)) return false;
    return true;
  });

  // Qo'lda qo'shilgan (bitta PINFL) mijozlarni SAQLAB qolamiz — faqat Excel'dan qurilganlarini
  // qayta quramiz. Excelda ham bor PINFL qo'lda qo'shilgan bo'lsa, dublikat bo'lmasin uchun chiqarib tashlaymiz.
  const manual = await prisma.mibClient.findMany({ where: { reportId: id, holat: MANUAL_HOLAT }, select: { pinfl: true } });
  const manualPinfls = new Set(manual.map((m) => m.pinfl));
  await prisma.mibClient.deleteMany({ where: { reportId: id, OR: [{ holat: { not: MANUAL_HOLAT } }, { holat: null }] } });
  const fresh = rows.filter((r) => !manualPinfls.has(r.pinfl));
  if (fresh.length) {
    await prisma.mibClient.createMany({
      data: fresh.map((r) => ({
        reportId: id, rowNo: r.rowNo, pinfl: r.pinfl, fio: r.fio, phone: r.phone, firm: r.firm,
        ishRaqami: r.ishRaqami, holat: r.holat, region: r.region, address: r.address, totalDebtSrc: r.totalDebtSrc,
      })),
    });
  }
  const total = await prisma.mibClient.count({ where: { reportId: id } });
  await prisma.mibReport.update({ where: { id }, data: { statusFilter, total } });
  return NextResponse.json({ total, statusFilter });
}
