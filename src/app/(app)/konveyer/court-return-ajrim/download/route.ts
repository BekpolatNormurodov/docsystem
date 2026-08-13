import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { downloadReturnAjrim } from '@/lib/court-return-ajrim';
import { SessionExpiredError } from '@/lib/session-store';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET ?caseNumber= — the ajrim PDF (the ruling where the concrete return reason is written).
export async function GET(req: NextRequest) {
  await requireUser();
  const caseNumber = req.nextUrl.searchParams.get('caseNumber');
  if (!caseNumber) return NextResponse.json({ error: 'caseNumber kerak' }, { status: 400 });
  try {
    const r = await downloadReturnAjrim(caseNumber);
    if (!r) return NextResponse.json({ error: 'Ajrim topilmadi' }, { status: 404 });
    return new NextResponse(new Uint8Array(r.buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.name)}`,
        'Content-Length': String(r.buf.length),
      },
    });
  } catch (e) {
    if (e instanceof SessionExpiredError)
      return NextResponse.json({ error: 'Cabinet kaliti ulanmagan — E-IMZO bilan qayta ulang.', needAuth: true }, { status: 401 });
    console.error('court-return-ajrim download failed', e);
    return NextResponse.json({ error: 'Ajrim yuklab boʻlmadi' }, { status: 500 });
  }
}
