import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

const numArg = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
const PAGE_SIZE = 50;

// Invoice holati (progress): to'lanmagan (yaratildi) → to'landi → sudda (keyingi bosqich).
const PAID_BEYOND = new Set(['INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED']);
const invStatusOf = (stage: string): 'created' | 'paid' | 'court' =>
  !PAID_BEYOND.has(stage) ? 'created' : stage === 'INVOICE_PAID' ? 'paid' : 'court';

// GET ?snapshotId=&firmId=&type=ariza|oferta|invoice&q=&page= — «Yaratilganlar»: qaysi mijozларга
// ariza/oferta yaratilgan (arizaAt/ofertaAt), yoki invoice (kvitansiya — receiptNumber) olingan.
// PINFL + F.I.O + firma + sud (+ kvitansiya) + sana bilan. Qidiruv (q): PINFL / ism / kvitansiya raqami.
// Sahifalab (page, 50 ta) — eng yangisi birinchi.
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const snapshotId = numArg(sp.get('snapshotId'));
  const firmId = numArg(sp.get('firmId'));
  const type = sp.get('type');
  const isOferta = type === 'oferta';
  const isInvoice = type === 'invoice';
  const q = (sp.get('q') || '').trim();
  const page = Math.max(1, Number(sp.get('page')) || 1);

  const scope = isInvoice ? { receiptNumber: { not: null } } : isOferta ? { ofertaAt: { not: null } } : { arizaAt: { not: null } };
  const qOr = q
    ? { OR: [{ pinfl: { contains: q } }, { clientName: { contains: q } }, ...(isInvoice ? [{ receiptNumber: { contains: q } }, { invoiceNo: { contains: q } }] : [])] }
    : {};
  const where = {
    ...(snapshotId ? { snapshotId } : {}),
    ...(firmId ? { firmId } : {}),
    ...scope,
    ...qOr,
  };

  const orderBy = isInvoice
    ? [{ id: 'desc' as const }] // invoice uchun alohida sana ustuni yo'q — id (yaratilish tartibi) bo'yicha
    : isOferta
      ? [{ ofertaAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ arizaAt: 'desc' as const }, { id: 'desc' as const }];

  const [total, rows] = await Promise.all([
    prisma.arizaCase.count({ where }),
    prisma.arizaCase.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, pinfl: true, clientName: true, kod: true, arizaAt: true, ofertaAt: true,
        receiptNumber: true, invoiceNo: true, stage: true,
        firm: { select: { shortName: true } },
        court: { select: { shortName: true } },
        ...(isInvoice ? { invoiceRecords: { select: { createdAt: true }, orderBy: { createdAt: 'desc' as const }, take: 1 } } : {}),
      },
    }),
  ]);

  const items = rows.map((r) => ({
    caseId: r.id,
    pinfl: r.pinfl,
    clientName: r.clientName,
    firmName: r.firm?.shortName ?? r.kod ?? null,
    courtName: r.court?.shortName ?? null,
    receiptNumber: isInvoice ? (r.receiptNumber ?? r.invoiceNo ?? null) : null,
    status: isInvoice ? invStatusOf(r.stage) : null,
    at: (isInvoice
      ? ((r as { invoiceRecords?: { createdAt: Date }[] }).invoiceRecords?.[0]?.createdAt ?? null)
      : isOferta ? r.ofertaAt : r.arizaAt)?.toISOString() ?? null,
  }));

  return NextResponse.json({ total, items, page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
}
