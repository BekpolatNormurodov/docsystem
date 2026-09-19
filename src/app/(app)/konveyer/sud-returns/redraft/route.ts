import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { canStep } from '@/lib/access';
import { createRedraftJob, RedraftError } from '@/lib/court-returns-tab';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST { firmId, caseIds?, snapshotId? } — faqat QAYTGAN ishlardan suit-rejim qayta qoralama
// partiyasi (save-suit → «Murojaatlarim», send-to-court YO'Q). → { jobId, total } | 409.
// Ruxsat: 'sud:returns' + 'sud:send' (2026-09-19).
export async function POST(req: NextRequest) {
  const u = await requireStep('sud:returns');
  const t = getT();
  if (!canStep(u, 'sud:send')) return NextResponse.json({ error: t('Bu amal uchun «Sudga yuborish» ruxsati kerak.') }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };
  const firmId = num(body?.firmId);
  if (!firmId) return NextResponse.json({ error: t('firmId kerak (har firma alohida)') }, { status: 400 });
  const caseIds = Array.isArray(body?.caseIds) ? (body.caseIds as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x > 0) : undefined;
  try {
    return NextResponse.json(await createRedraftJob(firmId, caseIds, u.id, num(body?.snapshotId)));
  } catch (e) {
    if (e instanceof RedraftError) return NextResponse.json({ error: `${t(e.key)}${e.extra ? ` ${e.extra}` : ''}` }, { status: e.status });
    console.error('sud-returns/redraft failed', e);
    return NextResponse.json({ error: t('Qayta qoralama partiyasi yaratilmadi.') }, { status: 500 });
  }
}
