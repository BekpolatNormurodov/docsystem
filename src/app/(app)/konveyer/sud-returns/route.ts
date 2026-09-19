import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { returnedCasesForTab } from '@/lib/court-returns-tab';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET ?firmId=&s= — /sud «Qaytganlar» tab'i: sud qaytargan ishlar (ArizaCase) + portal natijasi +
// sabab + holat (kutmoqda/ushlab turilgan/navbatda/xato/qayta tayyorlangan) + tayyorlik.
// 2026-09-19: eski court-returns route'lari requireUser bilan ochiq edi — bu tab 'sud:returns'
// ruxsatiga bog'langan (sidebar'dagi «Qaytganlar» grant'i bilan bir xil).
export async function GET(req: NextRequest) {
  await requireStep('sud:returns');
  const t = getT();
  const sp = req.nextUrl.searchParams;
  const num = (v: string | null): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  try {
    return NextResponse.json(await returnedCasesForTab({ snapshotId: num(sp.get('s')), firmId: num(sp.get('firmId')) }));
  } catch (e) {
    console.error('sud-returns failed', e);
    return NextResponse.json({ error: t('Qaytganlar yuklanmadi') }, { status: 500 });
  }
}
