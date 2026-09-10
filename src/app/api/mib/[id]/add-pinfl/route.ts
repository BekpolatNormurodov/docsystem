import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { addPinflAndCheck } from '@/lib/mib/add-pinfl';
import { getMibConfig } from '@/lib/mib/config';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST { pinfl } — reportga bitta PINFL qo'shib DARHOL tekshiradi. Natija (ijro ishlari + tekshiruv
// sanasi) shu reportga saqlanadi va yig'ilib boradi; «Qo'lda» belgisi bilan (Excel qayta qurishda
// o'chmaydi). Mavjud PINFL — eski ishlarni o'chirib qayta tekshiriladi.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id }, select: { id: true } });
  if (!report) return NextResponse.json({ error: 'Hisobot topilmadi' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const res = await addPinflAndCheck(id, String(body?.pinfl ?? ''), (String(body?.fio ?? '').trim() || null));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  const cfg = await getMibConfig();
  return NextResponse.json({ ok: true, reportId: id, clientId: res.clientId, running: res.running, phoneConfigured: !!cfg.phone });
}
