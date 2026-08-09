import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSlaConfig, setSla, SLA_EDITABLE, SLA_DEFAULTS } from '@/lib/konveyer-sla';

export const runtime = 'nodejs';

// GET → current per-phase SLA (working days) + defaults + editable rows.
export async function GET() {
  await requireAdmin();
  const config = await getSlaConfig();
  return NextResponse.json({ config, defaults: SLA_DEFAULTS, editable: SLA_EDITABLE });
}

// POST { sla: { SIGN: 3, COURT: 11, ... } } — save per-phase SLA (working days).
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const sla = body?.sla;
  if (!sla || typeof sla !== 'object') return NextResponse.json({ error: 'sla obyekti kerak' }, { status: 400 });
  const allowed = new Set(SLA_EDITABLE.map((e) => e.key));
  for (const [phase, days] of Object.entries(sla)) {
    if (!allowed.has(phase as any)) continue;
    const d = Number(days);
    if (!Number.isFinite(d) || d < 0 || d > 60) return NextResponse.json({ error: `${phase}: 0–60 kun` }, { status: 400 });
    await setSla(phase, d);
  }
  return NextResponse.json({ ok: true, config: await getSlaConfig() });
}
