// Cabinet state-fee (davlat boji) invoices tracked in the DB through their payment
// lifecycle: NOT_PAID -> IN_PROCESS ("jarayonida") -> PAID. A claim may only be
// submitted once its fee invoice is PAID. Wraps the cabinet fee/invoice API and
// persists every step to CourtFeeInvoice.
import type { FeeInvoiceStatus } from '@prisma/client';
import { prisma } from '../db';
import { cabinetFetch } from './api';
import type { CabinetSession } from './oneid';

export interface FeeParams {
  draftId?: string;
  instance?: 'FIRST' | 'APPEAL' | 'CASSATION';
  claimType?: 'CIVIL' | 'ECONOMIC' | 'ADMINISTRATIVE';
  claimKind?: 'SUIT' | 'MATERIAL';
  amount: number; // da'vo summasi (so'm)
}

export const STATUS_LABEL: Record<FeeInvoiceStatus, string> = {
  NOT_PAID: "To'lanmagan",
  IN_PROCESS: 'Jarayonida',
  PAID: "To'landi",
};

const num = (v: any) => (v == null || v === '' ? null : Number(v));

// Compute the fee via cabinet and store a NOT_PAID invoice record. Returns the
// fee breakdown {POST, VCC, STATE} + the stored row.
export async function computeAndRecordFee(session: CabinetSession, account: string, p: FeeParams) {
  const body = {
    instance: p.instance ?? 'FIRST',
    claim_type: p.claimType ?? 'CIVIL',
    claim_kind: p.claimKind ?? 'SUIT',
    amount: p.amount,
    withVCC: true,
  };
  const r = await cabinetFetch(session, '/api/cabinet/case/calc-duties-by-params', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`calc-duties failed (${r.status}): ${JSON.stringify(r.json).slice(0, 160)}`);
  const fees = r.json as { POST?: number; VCC?: number; STATE?: number };
  const post = num(fees.POST), vcc = num(fees.VCC), state = num(fees.STATE);
  const total = (post ?? 0) + (vcc ?? 0) + (state ?? 0);

  const row = await prisma.courtFeeInvoice.create({
    data: {
      account, draftId: p.draftId ?? null,
      instance: body.instance, claimType: body.claim_type, claimKind: body.claim_kind,
      claimAmount: p.amount, amountPost: post, amountVcc: vcc, amountState: state, amountTotal: total,
      status: 'NOT_PAID', meta: { calc: fees },
    },
  });
  return { fees, total, invoice: row };
}

// Attach a receipt number to an invoice and mark it IN_PROCESS ("jarayonida" —
// payment initiated, awaiting confirmation).
export async function markInvoiceInProcess(id: number, receiptNumber: string) {
  return prisma.courtFeeInvoice.update({
    where: { id }, data: { receiptNumber, status: 'IN_PROCESS' },
  });
}

// Check payment with cabinet by receipt number and, if confirmed paid, flip the
// stored invoice to PAID. NOTE: the exact find-by-receipt-number body
// (`invoiceStatus` enum) is still being confirmed against the live wizard; this
// records the raw response either way so the transition is auditable.
export async function syncInvoicePayment(session: CabinetSession, id: number, receiptNumber: string, invoiceStatus?: string) {
  const body: Record<string, any> = { receipt_number: receiptNumber };
  if (invoiceStatus) body.invoiceStatus = invoiceStatus;
  const r = await cabinetFetch(session, '/api/cabinet/guide/find-by-receipt-number', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j: any = r.json;
  const paid = r.ok && j && !j.statusCode &&
    (j.paid === true || /PAID|PAYED|TOLANGAN|OPLAT/i.test(JSON.stringify(j?.status ?? j?.invoiceStatus ?? '')) || !!j.paidAt || !!j.paid_date);
  const row = await prisma.courtFeeInvoice.update({
    where: { id },
    data: {
      receiptNumber,
      status: paid ? 'PAID' : undefined,
      paidAt: paid ? new Date() : undefined,
      meta: { find: j } as any,
    },
  });
  return { paid, response: j, invoice: row };
}

export const getInvoice = (id: number) => prisma.courtFeeInvoice.findUnique({ where: { id } });
export const listInvoices = (account: string) =>
  prisma.courtFeeInvoice.findMany({ where: { account }, orderBy: { createdAt: 'desc' } });
export const listInvoicesForDraft = (draftId: string) =>
  prisma.courtFeeInvoice.findMany({ where: { draftId }, orderBy: { createdAt: 'desc' } });
