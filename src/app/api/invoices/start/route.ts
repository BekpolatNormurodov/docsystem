import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { startBatch } from '@/lib/invoice-automation';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  const count = Math.max(1, Math.min(10, Number(body?.count) || 1));
  const paymentType = String(body?.paymentType ?? 'Почта харажатлари');
  const amount = Number(body?.amount);
  if (!firmId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'firmId va summa toʻgʻri boʻlishi kerak' }, { status: 400 });
  }
  try {
    const res = await startBatch({ firmId, count, paymentType, amount });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Xatolik' }, { status: 500 });
  }
}
