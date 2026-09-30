import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { setCasePause, PAUSE_REASON_MAX } from '@/lib/case-pause';
import { audit, AuditAction } from '@/lib/audit';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';

// POST { caseIds: number[], pause: boolean, reason?: string } — ishni SABAB bilan PAUZAGA qo'yish
// (meta.pause) yoki pauzadan chiqarish. Pauzadagi ish ariza/paket/oferta ZIP'lariga, ADOLAT qoralamasi
// va sudga yuborishga, talabnoma yuborishga tushmaydi (case-pause.ts). Ruxsat — «Qoralama» tabidagi
// mijozlar ro'yxati (court-ready/clients) bilan bir xil ('sud:send').
export async function POST(req: NextRequest) {
  const u = await requireStep('sud:send');
  const t = getT();
  const body = await req.json().catch(() => ({}));
  const caseIds = Array.isArray(body?.caseIds)
    ? [...new Set((body.caseIds as unknown[]).map(Number).filter((x): x is number => Number.isInteger(x) && x > 0))]
    : [];
  if (!caseIds.length) return NextResponse.json({ error: t('caseIds kerak') }, { status: 400 });
  if (typeof body?.pause !== 'boolean') return NextResponse.json({ error: t('pause (true/false) kerak') }, { status: 400 });
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (body.pause && !reason) return NextResponse.json({ error: t('Pauza sababini yozing') }, { status: 400 });
  if (reason.length > PAUSE_REASON_MAX) return NextResponse.json({ error: `${t('Sabab juda uzun')} (≤ ${PAUSE_REASON_MAX})` }, { status: 400 });
  try {
    const r = await setCasePause(caseIds, body.pause ? { reason, by: u.fullName || u.username } : null);
    await audit(AuditAction.CASE_PAUSE, {
      target: caseIds.length === 1 ? `case:${caseIds[0]}` : `cases:${caseIds.length}`,
      detail: { pause: body.pause, reason: body.pause ? reason : undefined, changed: r.changed, caseIds: caseIds.slice(0, 200) },
    });
    return NextResponse.json({ ok: true, changed: r.changed, pause: r.pause });
  } catch (e) {
    console.error('case-pause failed', e);
    return NextResponse.json({ error: t('Saqlanmadi — qayta urinib ko‘ring.') }, { status: 500 });
  }
}
