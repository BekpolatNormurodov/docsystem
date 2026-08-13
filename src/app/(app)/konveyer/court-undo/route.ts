import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { undoCaseState } from '@/lib/court-ready';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// POST { caseIds } — «Bekor qilish»: yuborilgan/qoralama belgisini (meta.exportedAt/draftAt) olib
// tashlab, mijozni «Tayyor»ga qaytaradi. Guarded by the 'sud' step (admins pass).
export async function POST(req: NextRequest) {
  await requireStep('sud');
  const body = await req.json().catch(() => ({}));
  const caseIds = Array.isArray(body?.caseIds)
    ? [...new Set((body.caseIds as unknown[]).map(Number).filter((x): x is number => Number.isInteger(x) && x > 0))]
    : [];
  if (!caseIds.length) return NextResponse.json({ error: 'caseIds kerak' }, { status: 400 });
  try {
    const reverted = await undoCaseState(caseIds);
    await audit(AuditAction.COURT_SUBMIT, { target: `cases:${caseIds.length}`, detail: { action: 'court-undo', reverted } });
    return NextResponse.json({ ok: true, reverted });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Bekor qilib boʻlmadi' }, { status: 400 });
  }
}
