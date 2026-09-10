import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { startMibRun, isMibRunActive, MANUAL_HOLAT } from '@/lib/mib/run';
import { getMibConfig } from '@/lib/mib/config';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST { pinfl } — bitta PINFL qo'shib DARHOL tekshiradi. Mavjud bo'lsa eski ishlarini o'chirib
// qayta tekshiradi (yangilash). Natija (ijro ishlari + tekshiruv sanasi) o'sha reportga saqlanadi va
// yig'ilib boradi — «Qo'lda» belgisi bilan (Excel qayta qurishda o'chib ketmaydi).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id noto‘g‘ri' }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id }, select: { id: true } });
  if (!report) return NextResponse.json({ error: 'Hisobot topilmadi' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const pinfl = String(body?.pinfl ?? '').replace(/\D/g, '');
  if (pinfl.length !== 14) return NextResponse.json({ error: 'PINFL 14 ta raqamdan iborat boʻlishi kerak' }, { status: 400 });
  const fio = (String(body?.fio ?? '').trim() || null) as string | null;

  let client = await prisma.mibClient.findFirst({ where: { reportId: id, pinfl } });
  if (client) {
    // Qayta tekshirish — eski ishlarni o'chirib, PENDING qilamiz (dublikat ish chiqmasin).
    await prisma.mibCase.deleteMany({ where: { clientId: client.id } });
    client = await prisma.mibClient.update({
      where: { id: client.id },
      data: { status: 'PENDING', error: null, checkedAt: null, attempts: 0, ...(fio ? { fio } : {}) },
    });
  } else {
    client = await prisma.mibClient.create({
      data: { reportId: id, pinfl, fio, holat: MANUAL_HOLAT, status: 'PENDING' },
    });
  }

  const total = await prisma.mibClient.count({ where: { reportId: id } });
  await prisma.mibReport.update({ where: { id }, data: { total } });

  const started = await startMibRun(id);
  const running = !!started || isMibRunActive(id);
  const cfg = await getMibConfig();
  return NextResponse.json({ ok: true, clientId: client.id, pinfl, running, phoneConfigured: !!cfg.phone });
}
