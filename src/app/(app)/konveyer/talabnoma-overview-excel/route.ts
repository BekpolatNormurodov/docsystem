import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { buildTalabnomaOverview, talabnomaOverviewBuffer } from '@/lib/hippo/talabnoma-overview';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST { snapshotId } — «Umumiy talabnoma reyestri»: a cross-firm overview .xlsx for the whole
// snapshot (Firmalar summary + Barcha talabnomalar data sheet, both filterable). Read-only, no
// chromium, no state change — it only summarizes what the per-firm exports would produce.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const n = Number(body?.snapshotId);
  const snapshotId = body?.snapshotId != null && Number.isInteger(n) && n > 0 ? n : undefined;
  if (!snapshotId) return NextResponse.json({ error: 'snapshotId kerak' }, { status: 400 });

  let ov;
  try {
    ov = await buildTalabnomaOverview(snapshotId);
  } catch (e) {
    console.error('talabnoma-overview build failed', e);
    return NextResponse.json({ error: 'Umumiy reyestr yaratilmadi' }, { status: 500 });
  }
  if (ov.firms.length === 0) return NextResponse.json({ error: 'Bu snapshotda firma yoʻq' }, { status: 422 });

  let buf: Buffer;
  try {
    buf = await talabnomaOverviewBuffer(ov);
  } catch (e) {
    console.error('talabnoma-overview excel failed', e);
    return NextResponse.json({ error: 'Excel yaratilmadi' }, { status: 500 });
  }

  const dateStr = ov.reportDate ? ov.reportDate.toISOString().slice(0, 10) : 'reyestr';
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Talabnoma_umumiy_${dateStr}.xlsx`)}"`,
    },
  });
}
