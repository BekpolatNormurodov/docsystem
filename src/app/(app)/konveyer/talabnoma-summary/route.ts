import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { loadTalabnomaRowsForScope } from '@/lib/hippo/talabnoma-bulk';
import { getSentTalabnomaPinfls, splitBySent } from '@/lib/hippo/talabnoma-trace';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET ?snapshotId=&firmId= — talabnoma totals for ONE firm (debt-gated, one per client), split by the
// «iz»: { count (=total), sent, remaining, totalDebt, remainingDebt }. Feeds the panel's summary
// line + the modal counts (so «Hammasi» / count operate on the UNSENT set). Same grouping as the
// reyestr export, so numbers match exactly.
export async function GET(req: NextRequest) {
  await requireUser();
  const int = (v: string | null): number => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
  const snapshotId = int(req.nextUrl.searchParams.get('snapshotId'));
  const firmId = int(req.nextUrl.searchParams.get('firmId'));
  if (!snapshotId || !firmId) return NextResponse.json({ error: 'snapshotId va firmId kerak' }, { status: 400 });

  try {
    const { rows, branchCode } = await loadTalabnomaRowsForScope({ snapshotId, firmId });
    const sentSet = branchCode ? await getSentTalabnomaPinfls(snapshotId, branchCode) : new Set<string>();
    const { remaining, sentCount } = splitBySent(rows, sentSet);
    const totalDebt = rows.reduce((s, r) => s + r.total_debt, 0);
    const remainingDebt = remaining.reduce((s, r) => s + r.total_debt, 0);
    return NextResponse.json({
      count: rows.length,          // total debt-gated talabnomalar (the whole court-bound set)
      sent: sentCount,             // already sent to hippo (traced)
      remaining: remaining.length, // still to send
      totalDebt,
      remainingDebt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Xatolik';
    const notFound = /topilmadi/i.test(msg);
    if (!notFound) console.error('talabnoma-summary failed', e);
    return NextResponse.json({ error: msg }, { status: notFound ? 404 : 500 });
  }
}
