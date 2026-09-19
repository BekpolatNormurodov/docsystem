import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { canStep } from '@/lib/access';
import { holdCases } from '@/lib/court-returns-tab';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';

// POST { caseIds: number[], hold: boolean } — qaytgan ishni USHLAB TURISH (meta.resendHold) yoki
// qo'yib yuborish. Ushlab turilgan ish Go/qayta qoralamaga olinmaydi (paket tuzatilguncha).
// Ruxsat: 'sud:returns' (tab) + 'sud:send' (sud oqimini o'zgartiradi) — 2026-09-19.
export async function POST(req: NextRequest) {
  const u = await requireStep('sud:returns');
  const t = getT();
  if (!canStep(u, 'sud:send')) return NextResponse.json({ error: t('Bu amal uchun «Sudga yuborish» ruxsati kerak.') }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const caseIds = Array.isArray(body?.caseIds) ? (body.caseIds as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x > 0) : [];
  if (!caseIds.length) return NextResponse.json({ error: t('caseIds kerak') }, { status: 400 });
  if (typeof body?.hold !== 'boolean') return NextResponse.json({ error: t('hold (true/false) kerak') }, { status: 400 });
  try {
    return NextResponse.json(await holdCases(caseIds, body.hold, u.id));
  } catch (e) {
    console.error('sud-returns/hold failed', e);
    return NextResponse.json({ error: t('Saqlanmadi — qayta urinib ko‘ring.') }, { status: 500 });
  }
}
