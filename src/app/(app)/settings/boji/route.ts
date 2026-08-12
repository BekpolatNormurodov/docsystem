import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getBojiAmount, setBojiAmount, BOJI_AMOUNT_DEFAULT } from '@/lib/konveyer-buxgalter';

export const runtime = 'nodejs';

// GET → current davlat-boji amount (soʻm) + the fallback default.
export async function GET() {
  await requireAdmin();
  const amount = await getBojiAmount();
  return NextResponse.json({ amount, default: BOJI_AMOUNT_DEFAULT });
}

// POST { amount } — save the davlat-boji amount (soʻm).
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
    return NextResponse.json({ error: 'Summa 0–100 000 000 oraligʻida boʻlsin' }, { status: 400 });
  }
  await setBojiAmount(amount);
  return NextResponse.json({ ok: true, amount: await getBojiAmount() });
}
