import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { canStep } from '@/lib/access';
import { fetchDeclineReasons } from '@/lib/court-returns-tab';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
// ≤30 ta ketma-ket so'rov × umumiy pacer (~4s) ≈ 2 daqiqa — zaxira bilan.
export const maxDuration = 300;

// POST { firmId?, caseIds?, snapshotId? } — ADOLAT'dan rad etish SABABLARINI (conflict-suit-view.
// decline_reasons) olib meta.declineReasons'ga yozadi. Bir chaqiruvda ≤30 ta; UI «qolgan»i bo'lsa
// qayta chaqiradi. → { fetched, failed, remaining, needAuth[], stopped }.
// Portalga so'rov yuboradi (faqat o'qish) — shuning uchun 'sud:send' ham talab qilinadi (2026-09-19).
export async function POST(req: NextRequest) {
  const u = await requireStep('sud:returns');
  const t = getT();
  if (!canStep(u, 'sud:send')) return NextResponse.json({ error: t('Bu amal uchun «Sudga yuborish» ruxsati kerak.') }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };
  const caseIds = Array.isArray(body?.caseIds) ? (body.caseIds as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x > 0) : undefined;
  try {
    return NextResponse.json(await fetchDeclineReasons({ firmId: num(body?.firmId), caseIds, snapshotId: num(body?.snapshotId) }));
  } catch (e) {
    console.error('sud-returns/reasons failed', e);
    return NextResponse.json({ error: t('Sabablar olinmadi — keyinroq qayta urinib ko‘ring.') }, { status: 500 });
  }
}
