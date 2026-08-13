import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { startRestBatch } from '@/lib/invoice-rest';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  const count = Math.max(1, Math.min(100, Number(body?.count) || 1));
  if (!firmId) {
    return NextResponse.json({ error: 'firmId toʻgʻri boʻlishi kerak' }, { status: 400 });
  }
  try {
    const res = await startRestBatch({ firmId, count });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Xatolik' }, { status: 500 });
  }
}
