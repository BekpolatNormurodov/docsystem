import { NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// GET — FIRMA bo'yicha navbatda qolgan (PENDING/RUNNING) ishlar soni.
//
// NEGA KERAK: «Yuborish navbati» faqat brauzer xotirasida (React state) turardi — sahifa
// yangilansa yo'qolardi va operator navbat bekor bo'ldi deb o'ylardi. Aslida ma'lumot
// yo'qolmaydi: har bir ishning holati `CourtQueueItem` da saqlanadi. Shuning uchun navbatni
// ALOHIDA saqlash shart emas — u SHU jadvaldan kelib chiqadi. Sahifa yangilangach shu
// endpoint chaqiriladi va «davom ettirish» taklif qilinadi.
export async function GET() {
  await requireStep('sud:send');

  const grouped = await prisma.courtQueueItem.groupBy({
    by: ['firmId', 'state'],
    where: { state: { in: ['PENDING', 'RUNNING'] } },
    _count: { _all: true },
  });
  if (!grouped.length) return NextResponse.json({ firms: [] });

  const firms = await prisma.firm.findMany({
    where: { id: { in: [...new Set(grouped.map((g) => g.firmId))] } },
    select: { id: true, shortName: true, stir: true },
  });
  const byId = new Map(firms.map((f) => [f.id, f]));

  const acc = new Map<number, { firmId: number; firmName: string; stir: string | null; pending: number; running: number }>();
  for (const g of grouped) {
    const f = byId.get(g.firmId);
    const row = acc.get(g.firmId) ?? {
      firmId: g.firmId,
      firmName: f?.shortName ?? `Firma ${g.firmId}`,
      stir: f?.stir ?? null,
      pending: 0,
      running: 0,
    };
    if (g.state === 'RUNNING') row.running += g._count._all;
    else row.pending += g._count._all;
    acc.set(g.firmId, row);
  }

  return NextResponse.json({
    firms: [...acc.values()].sort((a, b) => (b.pending + b.running) - (a.pending + a.running)),
  });
}
