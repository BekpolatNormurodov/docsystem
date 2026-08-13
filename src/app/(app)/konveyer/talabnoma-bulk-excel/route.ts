import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { loadTalabnomaRowsForScope } from '@/lib/hippo/talabnoma-bulk';
import { talabnomaExcelBuffer } from '@/lib/hippo/talabnoma-excel';
import { getSentTalabnomaPinfls, splitBySent } from '@/lib/hippo/talabnoma-trace';

export const runtime = 'nodejs';

// POST { snapshotId, firmId, limit? } — the firm's talabnoma reyestr as ONE .xlsx (hippo import
// layout, one row per client). Deduped against the «iz»: only the UNSENT rows, and (with `limit`)
// only the first N of them — so «hammasi» / «son» match the send. Fast (no chromium) → streamed
// back. No state change: a download does not commit the trace; only the in-app send does.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const num = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(body?.snapshotId);
  const firmId = num(body?.firmId);
  const limit = num(body?.limit);
  if (!snapshotId || !firmId) return NextResponse.json({ error: 'snapshotId va firmId kerak' }, { status: 400 });

  let rows, firmShort, docDate, branchCode;
  try {
    ({ rows, firmShort, docDate, branchCode } = await loadTalabnomaRowsForScope({ snapshotId, firmId }));
  } catch (e) {
    // The loader only throws by design for a missing firm/snapshot (a true 404). Anything else is an
    // infra/DB failure → 500 + a server log, not a misleading "not found" with no trace to diagnose.
    const msg = e instanceof Error ? e.message : 'Yuklab boʻlmadi';
    const notFound = /topilmadi/i.test(msg);
    if (!notFound) console.error('talabnoma-bulk-excel loader failed', e);
    return NextResponse.json({ error: msg }, { status: notFound ? 404 : 500 });
  }
  if (rows.length === 0) return NextResponse.json({ error: 'Bu firmada talabnoma qatori yoʻq (qarzdorlik 0 yoki maʼlumot yoʻq)' }, { status: 422 });

  // Only the unsent rows (dedupe), then the first N if a count was given.
  const sentSet = branchCode ? await getSentTalabnomaPinfls(snapshotId, branchCode) : new Set<string>();
  let { remaining } = splitBySent(rows, sentSet);
  if (remaining.length === 0) return NextResponse.json({ error: 'Barcha talabnomalar joʻnatilgan — yangi reyestr yoʻq' }, { status: 422 });
  if (limit && limit > 0 && limit < remaining.length) remaining = remaining.slice(0, limit);

  let buf: Buffer;
  try {
    buf = await talabnomaExcelBuffer(remaining);
  } catch (e) {
    console.error('talabnoma-bulk-excel failed', e);
    return NextResponse.json({ error: 'Excel yaratilmadi' }, { status: 500 });
  }

  const dateStr = docDate.toISOString().slice(0, 10);
  const safeFirm = (firmShort || 'firma').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Talabnoma_reyestr_${safeFirm}_${dateStr}.xlsx`)}"`,
    },
  });
}
