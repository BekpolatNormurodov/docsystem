import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { cabinetReturnedCases } from '@/lib/court-returns';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET ?s=&firmId= — clients the court RETURNED/REFUSED (from cabinet.sud.uz), to be fixed & re-filed.
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const num = (v: string | null): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(sp.get('s'));
  const firmId = num(sp.get('firmId'));
  try {
    const returns = await cabinetReturnedCases(snapshotId, firmId);
    // Group by result for a quick summary.
    const byResult: Record<string, number> = {};
    for (const r of returns) byResult[r.resultLabel] = (byResult[r.resultLabel] ?? 0) + 1;
    return NextResponse.json({ total: returns.length, byResult, returns });
  } catch (e) {
    console.error('court-returns failed', e);
    return NextResponse.json({ error: 'Qaytganlar yuklanmadi' }, { status: 500 });
  }
}
