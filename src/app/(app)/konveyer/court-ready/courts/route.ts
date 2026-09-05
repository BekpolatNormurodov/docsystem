import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireStep } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { sendableCourtBreakdown } from '@/lib/court-ready';

export const runtime = 'nodejs';

const num = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

// GET ?firmId=&s= — «Sudga yuborish» modali uchun: shu firmaning YUBORISHGA TAYYOR
// case'lari qaysi sudlarga nechtadan ketishi (ko'rsatkich). Snapshot: ?s= → cookie → latest.
export async function GET(req: NextRequest) {
  await requireStep('sud');
  const firmId = num(req.nextUrl.searchParams.get('firmId'));
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });
  const snaps = await konveyerSnapshots();
  const raw = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = num(raw);
  const snapshotId = parsed && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const { courts, total } = await sendableCourtBreakdown({ snapshotId, firmId });
  return NextResponse.json({ courts, total });
}
