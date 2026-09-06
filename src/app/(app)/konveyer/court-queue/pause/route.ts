import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isQueuePaused, setQueuePaused } from '@/lib/cabinet/pacer';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// GET — jarayon pauzadami + BARCHA firmalar bo'yicha umumiy holat.
//
// Raqamlar shu yerdan beriladi (firma bo'yicha emas, umumiy): operator sahifa tepasida
// bir qarashda «hozir nima bo'lyapti» ni ko'rishi kerak — nechta ish navbatda turibdi,
// nechtasi ketdi, nechtasi xato bergan.
export async function GET() {
  await requireStep('sud');
  const [paused, grouped] = await Promise.all([
    isQueuePaused(),
    prisma.courtQueueItem.groupBy({ by: ['state'], _count: { _all: true } }),
  ]);
  const counts: Record<string, number> = { PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0, SKIPPED: 0 };
  for (const g of grouped) counts[g.state] = g._count._all;
  return NextResponse.json({ paused, counts });
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
