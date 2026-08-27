import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { invoiceProgress, listBatches, getBojiAmount } from '@/lib/konveyer-buxgalter';
import { startRestBatchForCases } from '@/lib/invoice-rest';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// GET ?s= — per-firm invoice progress + recent batch history.
export async function GET(req: NextRequest) {
  await requireUser();
  const s = req.nextUrl.searchParams.get('s');
  const snapshotId = s ? Number(s) : undefined;
  const fid = req.nextUrl.searchParams.get('firmId');
  const firmId = fid ? Number(fid) : undefined;
  const [firms, batches, amount] = await Promise.all([invoiceProgress(snapshotId, firmId), listBatches(snapshotId, firmId), getBojiAmount()]);
  return NextResponse.json({ firms, batches, amount });
}

// POST { firmId, count, s? } — imzodan o'tgan (SIGNED_SCANNED) case'larga HAQIQIY
// billing boji kvitansiyasi yaratadi (REST, fonda). Darhol { restBatchId,
// invoiceBatchId, total } qaytaradi; progress /api/invoices/batch/[restBatchId] dan.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  const count = Number(body?.count);
  const snapshotId = body?.s ? Number(body.s) : undefined;
  if (!firmId || !count) return NextResponse.json({ error: 'firmId va count kerak' }, { status: 400 });
  try {
    const result = await startRestBatchForCases({ firmId, count, snapshotId });
    if (result.total === 0) {
      return NextResponse.json({ error: 'Kvitansiyasiz case yoʻq' }, { status: 400 });
    }
    await audit(AuditAction.INVOICE_BATCH, { target: `firm:${firmId}`, detail: { count, total: result.total } });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Batch xatosi' }, { status: 400 });
  }
}
