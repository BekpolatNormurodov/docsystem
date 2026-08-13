import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { konveyerPersons } from '@/lib/konveyer';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';

// People (grouped by PINFL, unified across firms) moving through the pipeline.
// GET /konveyer/cases?firmId=1&stages=IMPORTED,...&s=3&page=1&q=...
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  // Validate numerics: a non-numeric param must degrade to undefined/default, NOT
  // become NaN and silently return an empty list on a populated dataset.
  const num = (raw: string | null): number | undefined => { const n = Number(raw); return raw != null && raw !== '' && Number.isFinite(n) ? n : undefined; };
  const posInt = (raw: string | null, dflt: number, max: number): number => { const n = Number(raw); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : dflt; };
  const firmId = num(sp.get('firmId'));
  const stages = (sp.get('stages') || '').split(',').filter(Boolean) as CaseStage[];
  const talabnoma = sp.get('talabnoma') === '1';
  const snapshotId = num(sp.get('s'));
  const page = posInt(sp.get('page'), 1, 1_000_000);
  const q = sp.get('q') || undefined;
  const pageSize = posInt(sp.get('pageSize'), 5, 100);
  const data = await konveyerPersons({ firmId, snapshotId, stages, talabnoma, q, page, pageSize });
  return NextResponse.json(data);
}
