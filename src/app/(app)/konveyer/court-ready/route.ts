import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireStep } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { courtReadiness, courtStatusBoard, courtReturns } from '@/lib/court-ready';

export const runtime = 'nodejs';

const num = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

// GET ?s=&firmId= — Sud sahifasi paneli uchun: sudga-tayyorlik (firma-firma),
// to'liq status hisoboti, va qaytganlar ro'yxati. Snapshot: ?s= → cookie → latest.
export async function GET(req: NextRequest) {
  await requireStep('sud');
  const snaps = await konveyerSnapshots();
  const raw = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = num(raw);
  const snapshotId = parsed && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const firmId = num(req.nextUrl.searchParams.get('firmId'));

  const [readiness, statusBoard, returns] = await Promise.all([
    courtReadiness(snapshotId, firmId),
    courtStatusBoard(snapshotId, firmId),
    courtReturns(snapshotId, firmId),
  ]);

  return NextResponse.json({ snapshotId, readiness, statusBoard, returns });
}
