import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { konveyerMibScope, seedKonveyerMibReport } from '@/lib/mib/from-konveyer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const num = (raw: string | null): number | undefined => {
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
};

// GET ?s=<snapshotId> — konveyerda MIBga chiqqan ishlar soni + mavjud konveyer-report id (yozmaydi).
export async function GET(req: NextRequest) {
  await requireAdmin();
  const snapshotId = num(req.nextUrl.searchParams.get('s'));
  return NextResponse.json(await konveyerMibScope({ snapshotId }));
}

// POST { snapshotId? } — konveyer MIB-reportini yaratadi/yangilaydi (voronkaning MIB case'laridan
// PINFL'larni urug'lantiradi). Idempotent — yangilarini qo'shadi, natijalarni saqlaydi.
export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const snapshotId = num(body?.snapshotId != null ? String(body.snapshotId) : null);
  const res = await seedKonveyerMibReport({ snapshotId, createdBy: user.username });
  return NextResponse.json(res);
}
