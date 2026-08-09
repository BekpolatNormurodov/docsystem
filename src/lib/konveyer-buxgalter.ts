// Buxgalter (accountant) flow: davlat-boji invoice batches per firm. Separate
// from the document pipeline — creating an invoice assigns a kvitansiya raqami
// to a case and marks it INVOICE_CREATED. 20 600 so'm each.
import { prisma } from './db';
import type { CaseStage } from '@prisma/client';
import { dueForStage } from './konveyer-sla';

export const BOJI_AMOUNT = 20600;
// Postal fee (farmoyish «Почта харажати») — a semantically DISTINCT fee that
// happens to equal the boji today. Kept separate so changing one never silently
// moves the other.
export const POSTAL_FEE = 20600;

// A boji invoice is "paid" once the case has REACHED INVOICE_PAID — it stays
// paid as the stage advances past it (court/MIB/closed), so match the whole tail.
const PAID_OR_BEYOND: CaseStage[] = ['INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];

export interface FirmInvoiceProgress {
  firmId: number;
  firmName: string;
  total: number; // court-list cases
  withInvoice: number; // already have a kvitansiya raqami
  remaining: number;
}

/** Per-firm invoice progress: how many cases have a boji invoice vs total.
 *  Optionally scoped to one firm (matches the dashboard's firm dropdown). */
export async function invoiceProgress(snapshotId?: number, firmId?: number): Promise<FirmInvoiceProgress[]> {
  const scope = { ...(snapshotId ? { snapshotId } : {}), ...(firmId ? { firmId } : {}) };
  const [firms, totals, withInv] = await Promise.all([
    prisma.firm.findMany({ where: firmId ? { id: firmId } : {}, select: { id: true, shortName: true } }),
    prisma.arizaCase.groupBy({ by: ['firmId'], where: scope, _count: { _all: true } }),
    prisma.arizaCase.groupBy({ by: ['firmId'], where: { ...scope, receiptNumber: { not: null } }, _count: { _all: true } }),
  ]);
  const totalBy = new Map(totals.map((t) => [t.firmId, t._count._all]));
  const invBy = new Map(withInv.map((t) => [t.firmId, t._count._all]));
  return firms
    .map((f) => {
      const total = totalBy.get(f.id) ?? 0;
      const withInvoice = invBy.get(f.id) ?? 0;
      return { firmId: f.id, firmName: f.shortName, total, withInvoice, remaining: total - withInvoice };
    })
    .filter((f) => f.total > 0)
    .sort((a, b) => b.total - a.total);
}

export interface BatchHistoryRow {
  id: number;
  firmName: string;
  count: number;
  paid: number;
  createdAt: string;
}

/** Recent invoice batches (history) — newest first, with paid counts. Filterable
 *  by snapshot (a batch belongs to a snapshot via its cases) and/or firm. */
export async function listBatches(snapshotId?: number, firmId?: number, limit = 20): Promise<BatchHistoryRow[]> {
  const batches = await prisma.invoiceBatch.findMany({
    where: {
      ...(firmId ? { firmId } : {}),
      ...(snapshotId ? { cases: { some: { snapshotId } } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { firm: { select: { shortName: true } }, _count: { select: { cases: true } } },
  });
  // Paid = cases in the batch whose stage reached INVOICE_PAID or beyond.
  const paidByBatch = new Map<number, number>();
  const paid = await prisma.arizaCase.groupBy({
    by: ['batchId'],
    where: { batchId: { in: batches.map((b) => b.id) }, stage: { in: PAID_OR_BEYOND } },
    _count: { _all: true },
  });
  for (const p of paid) if (p.batchId != null) paidByBatch.set(p.batchId, p._count._all);
  return batches.map((b) => ({
    id: b.id,
    firmName: b.firm.shortName,
    count: b._count.cases,
    paid: paidByBatch.get(b.id) ?? 0,
    createdAt: b.createdAt.toISOString(),
  }));
}

// Plausible kvitansiya raqami (12 digits) — deterministic per case. Real numbers
// come from cabinet.sud.uz billing; this is the local record until that runs.
const receiptFor = (caseId: number) => '2621' + String(80000000 + caseId).slice(-8);

export interface BatchResult {
  batchId: number;
  created: number;
  firmName: string;
  receipts: { caseId: number; clientName: string | null; kod: string | null; receiptNumber: string }[];
}

/**
 * Create `count` boji invoices for a firm's oldest cases that don't have one yet.
 * Assigns each a kvitansiya raqami, moves it to INVOICE_CREATED, and records an
 * InvoiceBatch (for the buxgalteriya farmoyishi). Idempotent-ish: only picks
 * cases without an invoice.
 */
export async function createInvoiceBatch(opts: { firmId: number; count: number; snapshotId?: number; court?: string }): Promise<BatchResult> {
  const { firmId } = opts;
  const count = Math.max(1, Math.floor(Number.isFinite(opts.count) ? opts.count : 1));
  const firm = await prisma.firm.findUniqueOrThrow({ where: { id: firmId }, select: { shortName: true } });

  const picked = await prisma.arizaCase.findMany({
    where: { firmId, receiptNumber: null, ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}) },
    orderBy: { id: 'asc' },
    take: count,
    select: { id: true, clientName: true, kod: true },
  });
  // No eligible cases → don't litter history with an empty batch.
  if (picked.length === 0) return { batchId: 0, created: 0, firmName: firm.shortName, receipts: [] };

  // Reset the SLA clock for the BOJ phase the case is entering (else it keeps the
  // stale deadline from its previous stage and is wrongly flagged overdue).
  const now = new Date();
  const dueAt = await dueForStage('INVOICE_CREATED', now);

  // Batch row + case assignments commit together (no orphan batch). Each case is
  // claimed with a receiptNumber:null guard so a concurrent batch can't double-assign.
  const { batchId, receipts } = await prisma.$transaction(async (tx) => {
    const batch = await tx.invoiceBatch.create({
      data: { firmId, court: opts.court ?? null, requestedCount: count, createdCount: 0, status: 'DONE' },
      select: { id: true },
    });
    const done: BatchResult['receipts'] = [];
    for (const c of picked) {
      const receiptNumber = receiptFor(c.id);
      const upd = await tx.arizaCase.updateMany({
        where: { id: c.id, receiptNumber: null },
        data: { receiptNumber, batchId: batch.id, stage: 'INVOICE_CREATED', stageEnteredAt: now, dueAt },
      });
      if (upd.count > 0) done.push({ caseId: c.id, clientName: c.clientName, kod: c.kod, receiptNumber });
    }
    await tx.invoiceBatch.update({ where: { id: batch.id }, data: { createdCount: done.length } });
    return { batchId: batch.id, receipts: done };
  }, { timeout: 30000 });

  return { batchId, created: receipts.length, firmName: firm.shortName, receipts };
}
