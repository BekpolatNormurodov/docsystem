import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { invoiceProgress, createInvoiceBatch, listBatches, BOJI_AMOUNT } from '@/lib/konveyer-buxgalter';

export const runtime = 'nodejs';

// GET ?s= — per-firm invoice progress + recent batch history.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const s = req.nextUrl.searchParams.get('s');
  const snapshotId = s ? Number(s) : undefined;
  const fid = req.nextUrl.searchParams.get('firmId');
  const firmId = fid ? Number(fid) : undefined;
  const [firms, batches] = await Promise.all([invoiceProgress(snapshotId, firmId), listBatches(snapshotId, firmId)]);
  return NextResponse.json({ firms, batches, amount: BOJI_AMOUNT });
}

// POST { firmId, count, s? } — create a boji invoice batch for a firm.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  const count = Number(body?.count);
  const snapshotId = body?.s ? Number(body.s) : undefined;
  if (!firmId || !count) return NextResponse.json({ error: 'firmId va count kerak' }, { status: 400 });
  try {
    const result = await createInvoiceBatch({ firmId, count, snapshotId });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Batch xatosi' }, { status: 400 });
  }
}
