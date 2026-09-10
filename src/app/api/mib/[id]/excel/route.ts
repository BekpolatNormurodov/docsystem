import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { buildMibExcel } from '@/lib/mib/excel';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET — download as .xlsx. To'liq: Mijozlar + Ishlar + kesim varaqlari (Firma/Region/Hudud/Bank).
//   ?tab=firma|region|hudud|bank — faqat o'sha kesim varag'i (dashboard tabidan).
//   ?client=<id> — faqat bitta mijozning ishlari.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: 'Hisobot topilmadi' }, { status: 404 });

  const tab = req.nextUrl.searchParams.get('tab') || undefined;
  const clientRaw = Number(req.nextUrl.searchParams.get('client'));
  const clientId = Number.isInteger(clientRaw) && clientRaw > 0 ? clientRaw : undefined;

  const clients = await prisma.mibClient.findMany({
    where: { reportId: id, ...(clientId ? { id: clientId } : {}) },
    orderBy: { id: 'asc' }, include: { cases: true },
  });

  const buf = await buildMibExcel(report, clients, { tab, clientId });
  const tag = tab ? `_${tab}` : clientId ? `_mijoz${clientId}` : '';
  const name = `MIB_${(report.label || report.sourceFileName).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}${tag}.xlsx`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
      'Content-Length': String(buf.length),
    },
  });
}
