import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { checkInvoiceStatus } from '@/lib/billing/invoice';
import { upsertCheckedInvoice } from '@/lib/billing-check/store';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// POST { invoice } — bitta kvitansiya raqamini billing.sud.uzdan tekshiradi/yangilaydi.
// Captchasiz, ochiq API (checkStatus). Natija keshga upsert qilinadi + qidiruv tarixga yoziladi.
export async function POST(req: NextRequest) {
  const user = await requireAccess('invoice-check');
  const body = await req.json().catch(() => ({}));
  const invoice = String(body?.invoice ?? '').trim();
  if (!invoice) return NextResponse.json({ error: 'Kvitansiya raqami kerak' }, { status: 400 });

  try {
    const b = await checkInvoiceStatus(invoice);
    const row = await upsertCheckedInvoice({
      number: b.number || invoice,
      invoiceStatus: b.invoiceStatus,
      amount: b.amount ?? null,
      paidAmount: b.paidAmount ?? null,
      mustPayAmount: b.mustPayAmount ?? null,
      payer: b.payer ?? null,
      payerTin: b.payerTin ?? null,
      court: b.court ?? null,
      courtId: b.courtId ?? null,
      forAccount: b.forAccount ?? null,
      description: b.description ?? null,
      payCategory: b.payCategory ?? null,
      claimCaseNumber: b.claimCaseNumber ?? null,
      source: 'SINGLE',
      raw: b.raw,
    });
    await prisma.billingCheckQuery.create({
      data: { createdBy: user.username, mode: 'SINGLE', query: invoice, resultCount: 1, status: 'OK' },
    });
    return NextResponse.json({ invoice: row });
  } catch (e: any) {
    const message = e?.message || 'Tekshirishda xato';
    await prisma.billingCheckQuery.create({
      data: { createdBy: user.username, mode: 'SINGLE', query: invoice, resultCount: 0, status: 'FAILED', message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
