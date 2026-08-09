// billing.sud.uz invoice check + document download. FULLY PUBLIC — no auth, no
// captcha for direct invoice-number lookups. Powers state-fee/postal invoice
// payment tracking + receipt-PDF download.
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db';

const BILLING = 'https://billing.sud.uz';

export interface BillingInvoice {
  invoiceStatus: string; // CREATED (unpaid) | PAID | ...
  paidAmount: number;
  mustPayAmount: number;
  amount: number;
  number: string;
  payCategory?: string;
  payCategoryId?: number;
  court?: string;
  courtId?: number;
  forAccount?: string;
  payer?: string;
  payerTin?: string;
  claimCaseNumber?: string | null;
  description?: string;
  raw: any;
}

// GET /api/invoice/checkStatus?invoice=..&lang=..  — payment status + details.
export async function checkInvoiceStatus(invoice: string, lang = 'ru'): Promise<BillingInvoice> {
  const res = await fetch(`${BILLING}/api/invoice/checkStatus?invoice=${encodeURIComponent(invoice)}&lang=${lang}`, {
    headers: { accept: 'application/json' },
  });
  const j: any = await res.json();
  if (j?.requestStatus?.code && j.requestStatus.code !== 200)
    throw new Error(`billing checkStatus ${j.requestStatus.code}: ${j.requestStatus.message}`);
  return {
    invoiceStatus: j.invoiceStatus, paidAmount: j.paidAmount, mustPayAmount: j.mustPayAmount,
    amount: j.amount, number: j.number, payCategory: j.payCategory, payCategoryId: j.payCategoryId,
    court: j.court, courtId: j.courtId, forAccount: j.forAccount, payer: j.payer, payerTin: j.payerTin,
    claimCaseNumber: j.claimCaseNumber, description: j.description, raw: j,
  };
}

// GET /api/invoice/asDocument?invoice=..  — the invoice/receipt PDF (public).
export async function downloadInvoice(invoice: string): Promise<Buffer> {
  const res = await fetch(`${BILLING}/api/invoice/asDocument?invoice=${encodeURIComponent(invoice)}`);
  if (!res.ok) throw new Error(`billing asDocument ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('billing asDocument: not a PDF');
  return buf;
}

// billing invoiceStatus -> our FeeInvoiceStatus.
export function mapStatus(invoiceStatus: string): 'NOT_PAID' | 'IN_PROCESS' | 'PAID' {
  const s = String(invoiceStatus || '').toUpperCase();
  if (s === 'PAID' || s === 'PAYED') return 'PAID';
  if (s === 'CREATED' || s === 'NEW') return 'NOT_PAID';
  return 'IN_PROCESS';
}

// Check billing for a CourtFeeInvoice's receiptNumber, update status/amounts, and
// download the invoice PDF (docPath). Returns the fresh billing info.
export async function syncBillingInvoice(courtFeeInvoiceId: number, opts: { download?: boolean } = {}) {
  const inv = await prisma.courtFeeInvoice.findUnique({ where: { id: courtFeeInvoiceId } });
  if (!inv?.receiptNumber) throw new Error('invoice has no receiptNumber');
  const b = await checkInvoiceStatus(inv.receiptNumber);
  const status = mapStatus(b.invoiceStatus);

  let docPath: string | undefined;
  if (opts.download !== false) {
    try {
      const buf = await downloadInvoice(inv.receiptNumber);
      const dir = path.join(process.cwd(), 'exports', 'billing-invoices');
      await fs.mkdir(dir, { recursive: true });
      docPath = path.join(dir, `${inv.receiptNumber}.pdf`);
      await fs.writeFile(docPath, buf);
    } catch { /* pdf optional */ }
  }

  const row = await prisma.courtFeeInvoice.update({
    where: { id: courtFeeInvoiceId },
    data: {
      status, paidAt: status === 'PAID' ? new Date() : null,
      amountTotal: b.mustPayAmount ?? inv.amountTotal,
      meta: { ...(inv.meta as any), billing: b.raw, docPath } as any,
    },
  });
  return { billing: b, status, docPath, invoice: row };
}
