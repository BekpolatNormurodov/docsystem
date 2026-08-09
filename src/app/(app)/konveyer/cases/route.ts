import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { konveyerPersons } from '@/lib/konveyer';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';

// People (grouped by PINFL, unified across firms) moving through the pipeline.
// GET /konveyer/cases?firmId=1&stages=IMPORTED,...&s=3&page=1&q=...
export async function GET(req: NextRequest) {
  await requireAdmin();
  const sp = req.nextUrl.searchParams;
  const firmId = sp.get('firmId') ? Number(sp.get('firmId')) : undefined;
  const stages = (sp.get('stages') || '').split(',').filter(Boolean) as CaseStage[];
  const talabnoma = sp.get('talabnoma') === '1';
  const snapshotId = sp.get('s') ? Number(sp.get('s')) : undefined;
  const page = sp.get('page') ? Number(sp.get('page')) : 1;
  const q = sp.get('q') || undefined;
  const pageSize = sp.get('pageSize') ? Number(sp.get('pageSize')) : 5;
  const data = await konveyerPersons({ firmId, snapshotId, stages, talabnoma, q, page, pageSize });
  return NextResponse.json(data);
}
