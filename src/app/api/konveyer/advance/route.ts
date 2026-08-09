import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { advanceStage } from '@/lib/konveyer';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';

// Move N of a firm's cases from one stage to the next (e.g. "palataga yetqizildi").
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  const from = String(body?.from ?? '') as CaseStage;
  const to = body?.to ? (String(body.to) as CaseStage) : undefined;
  const count = Number(body?.count);
  if (!firmId || !from) return NextResponse.json({ error: 'firmId/from kerak' }, { status: 400 });
  try {
    const result = await advanceStage(firmId, from, count, to);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'advance xatosi' }, { status: 400 });
  }
}
