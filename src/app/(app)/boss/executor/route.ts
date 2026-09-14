import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// Region → ijrochi biriktirish (boshliq hisobotidagi «Ijrochi» ustuni). FAQAT admin.
// POST { region, executorName, phone? } → upsert. Bo'sh executorName → biriktirmani o'chiradi.
export async function POST(req: NextRequest) {
  await requireAdmin();
  let body: { region?: string; executorName?: string; phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const region = (body.region ?? '').trim();
  const executorName = (body.executorName ?? '').trim();
  const phone = (body.phone ?? '').trim() || null;
  if (!region) return NextResponse.json({ error: 'region required' }, { status: 400 });

  if (!executorName) {
    // Bo'sh nom → biriktirmani olib tashlaymiz (region qatorida «biriktirilmagan» ko'rinadi).
    await prisma.regionExecutor.deleteMany({ where: { region } });
    return NextResponse.json({ ok: true, region, executorName: null });
  }
  const saved = await prisma.regionExecutor.upsert({
    where: { region },
    create: { region, executorName, phone },
    update: { executorName, phone },
    select: { region: true, executorName: true, phone: true },
  });
  return NextResponse.json({ ok: true, ...saved });
}
