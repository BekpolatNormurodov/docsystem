import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { isQueuePaused, setQueuePaused } from '@/lib/cabinet/pacer';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// GET — jarayon pauzadami?
export async function GET() {
  await requireStep('sud');
  return NextResponse.json({ paused: await isQueuePaused() });
}

// POST { paused: boolean } — BUTUN sudga yuborish jarayonini to'xtatib turish / davom ettirish.
//
// «Bekor» (Job.cancelRequested) dan farqi: u bitta partiyani tugatadi, bu esa barcha
// firmalarga taalluqli va bazada saqlanadi — deploy/restart'dan keyin ham kuchda qoladi.
// Pauzada ishlar PENDING bo'lib qoladi, davom ettirilganda aynan shu joydan ketadi.
export async function POST(req: NextRequest) {
  await requireStep('sud');
  const body = await req.json().catch(() => ({}));
  const paused = body?.paused === true;
  await setQueuePaused(paused);
  await audit(AuditAction.COURT_SUBMIT, {
    target: 'court-queue',
    detail: { amal: paused ? 'jarayon pauzaga olindi' : 'jarayon davom ettirildi' },
  });
  return NextResponse.json({ paused });
}
