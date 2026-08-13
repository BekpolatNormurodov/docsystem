import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getReturnAjrim } from '@/lib/court-return-ajrim';
import { SessionExpiredError } from '@/lib/session-store';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET ?caseNumber= — LIVE ajrim metadata (turi/sudya/sud) for a returned cabinet case.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseNumber = req.nextUrl.searchParams.get('caseNumber');
  if (!caseNumber) return NextResponse.json({ error: 'caseNumber kerak' }, { status: 400 });
  try {
    return NextResponse.json(await getReturnAjrim(caseNumber));
  } catch (e) {
    if (e instanceof SessionExpiredError)
      return NextResponse.json({ error: 'Cabinet kaliti ulanmagan — «Ulanishlar» orqali E-IMZO bilan qayta ulang.', needAuth: true }, { status: 401 });
    console.error('court-return-ajrim failed', e);
    return NextResponse.json({ error: 'Ajrim maʼlumoti olinmadi' }, { status: 500 });
  }
}
