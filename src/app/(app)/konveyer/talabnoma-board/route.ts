import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { talabnomaBoard } from '@/lib/hippo/talabnoma-board';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// GET ?snapshotId= — Talabnoma sahifasi tepasidagi KPI + firma×holat jadvali raqamlari.
// FAOL firmalar bo'yicha (nofaol firma chiqmaydi). Sahifa yuki tez qolishi uchun klient mount'dan
// keyin chaqiradi (buildTalabnomaOverview kabi firma-firma scoped so'rovlar — bir necha soniya).
export async function GET(req: NextRequest) {
  await requireStep('talabnoma');
  const raw = Number(req.nextUrl.searchParams.get('snapshotId'));
  const snapshotId = Number.isInteger(raw) && raw > 0 ? raw : 0;
  if (!snapshotId) return NextResponse.json({ error: 'snapshotId kerak' }, { status: 400 });
  try {
    const board = await talabnomaBoard(snapshotId);
    return NextResponse.json(board);
  } catch (e) {
    console.error('talabnoma-board failed', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Xatolik' }, { status: 500 });
  }
}
