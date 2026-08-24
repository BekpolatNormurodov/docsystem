import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getOwnAmounts, setOwnAmounts, DEFAULT_OWN_AMOUNTS_TIYIN } from '@/lib/billing-check/config';

export const runtime = 'nodejs';

// GET — «bizning summalarimiz» (tiyinda) + default (qaytarish tugmasi uchun).
export async function GET(_req: NextRequest) {
  await requireAdmin();
  return NextResponse.json({ ownAmounts: await getOwnAmounts(), defaults: DEFAULT_OWN_AMOUNTS_TIYIN });
}

// POST { amounts: number[] } — tiyinda. Bo'sh ro'yxat ham qabul qilinadi
// («hech biri bizniki emas» degani); default'ga qaytarish alohida amal.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body?.amounts)) return NextResponse.json({ error: 'amounts massiv bo‘lishi kerak' }, { status: 400 });
  const saved = await setOwnAmounts(body.amounts.map(Number));
  return NextResponse.json({ ownAmounts: saved });
}
