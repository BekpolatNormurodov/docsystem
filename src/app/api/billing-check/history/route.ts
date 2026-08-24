import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// Qidiruv tarixi — keshdagi kvitansiyalardan alohida (u endi sahifalanadi, har poll'da
// 2000 qatorni qayta o'qimaslik uchun ajratildi).
export async function GET(_req: NextRequest) {
  await requireAdmin();
  const queries = await prisma.billingCheckQuery.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return NextResponse.json({ queries });
}

// POST { query, resultCount, status?, message? } — ommaviy yig'ish tugagach BITTA umumiy
// tarix yozuvi. Sahifalar `silent` rejimda tortilgani uchun ular alohida yozilmaydi.
export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const query = String(body?.query ?? '').trim();
  if (!query) return NextResponse.json({ error: 'query kerak' }, { status: 400 });
  const resultCount = Math.max(0, Number(body?.resultCount) || 0);
  const status = body?.status === 'FAILED' ? 'FAILED' : 'OK';
  const message = body?.message ? String(body.message).slice(0, 500) : null;

  const row = await prisma.billingCheckQuery.create({
    data: { createdBy: user.username, mode: 'LIST', query, page: null, resultCount, status, message },
  });
  return NextResponse.json({ query: row });
}
