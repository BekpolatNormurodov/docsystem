// Buxgalter (accountant) flow: davlat-boji invoice batches per firm. Separate
// from the document pipeline — creating an invoice assigns a kvitansiya raqami
// to a case and marks it INVOICE_CREATED. 20 600 so'm each.
import { prisma } from './db';
import type { CaseStage } from '@prisma/client';
import { dueForStage } from './konveyer-sla';
import { firmCourtsOrdered } from './court-routing';

// Davlat-boji amount (soʻm). Editable in Sozlamalar and stored as a Setting; this
// is only the fallback default when nothing is saved. Hamma sudga bir xil summa ketadi.
export const BOJI_AMOUNT_DEFAULT = 22000;
const BOJI_KEY = 'boji_amount';

/** Current davlat-boji amount — the saved Setting, or the default. */
export async function getBojiAmount(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: BOJI_KEY } });
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : BOJI_AMOUNT_DEFAULT;
}

/** Save the davlat-boji amount (soʻm). Clamped to a sane non-negative integer. */
export async function setBojiAmount(amount: number): Promise<void> {
  const clean = Math.max(0, Math.min(100_000_000, Math.round(Number(amount) || 0)));
  await prisma.setting.upsert({ where: { key: BOJI_KEY }, create: { key: BOJI_KEY, value: String(clean) }, update: { value: String(clean) } });
}

// Postal fee (farmoyish «Почта харажати») — a semantically DISTINCT fee that
// happens to equal the boji today. Kept separate so changing one never silently
// moves the other.
export const POSTAL_FEE = 22000;

// A boji invoice is "paid" once the case has REACHED INVOICE_PAID — it stays
// paid as the stage advances past it (court/MIB/closed), so match the whole tail.
const PAID_OR_BEYOND: CaseStage[] = ['INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];

export interface FirmInvoiceProgress {
  firmId: number;
  firmName: string;
  total: number; // court-list cases
  withInvoice: number; // already have a kvitansiya raqami
  remaining: number;
  eligible: number; // imzodan o'tgan (SIGNED_SCANNED) va kvitansiyasiz — billing SHULARGA ishlaydi
}

/** Per-firm invoice progress: how many cases have a boji invoice vs total, and how many are
 *  billing-ELIGIBLE right now (SIGNED_SCANNED, kvitansiyasiz — the pool startRestBatchForCases
 *  actually invoices; «remaining» counts every no-invoice case, most of which aren't signed yet).
 *  Optionally scoped to one firm (matches the dashboard's firm dropdown). */
export async function invoiceProgress(snapshotId?: number, firmId?: number): Promise<FirmInvoiceProgress[]> {
  const scope = { ...(snapshotId ? { snapshotId } : {}), ...(firmId ? { firmId } : {}) };
  const [firms, totals, withInv, eligible] = await Promise.all([
    prisma.firm.findMany({ where: firmId ? { id: firmId } : {}, select: { id: true, shortName: true } }),
    prisma.arizaCase.groupBy({ by: ['firmId'], where: scope, _count: { _all: true } }),
    prisma.arizaCase.groupBy({ by: ['firmId'], where: { ...scope, receiptNumber: { not: null } }, _count: { _all: true } }),
    // «eligible» = boji yaratsa bo'ladigan pool. Endi skan sharti YO'Q — har qanday kvitansiyasiz case.
    prisma.arizaCase.groupBy({ by: ['firmId'], where: { ...scope, receiptNumber: null }, _count: { _all: true } }),
  ]);
  const totalBy = new Map(totals.map((t) => [t.firmId, t._count._all]));
  const invBy = new Map(withInv.map((t) => [t.firmId, t._count._all]));
  const eligBy = new Map(eligible.map((t) => [t.firmId, t._count._all]));
  return firms
    .map((f) => {
      const total = totalBy.get(f.id) ?? 0;
      const withInvoice = invBy.get(f.id) ?? 0;
      return { firmId: f.id, firmName: f.shortName, total, withInvoice, remaining: total - withInvoice, eligible: eligBy.get(f.id) ?? 0 };
    })
    .filter((f) => f.total > 0)
    .sort((a, b) => b.total - a.total);
}

// ── Per-court invoice breakdown ──────────────────────────────────────────────
// A firm can route to several courts (CourtFirmAccess), and each ArizaCase carries
// its own courtId (the court its ariza addresses). Boji invoices must be created
// PER COURT — every invoice in a batch shares one billing «Sud id», so a multi-court
// firm needs one batch per court. This powers the «Invoice yaratish» court breakdown.

/** One court bucket under a firm: how many kvitansiyasiz cases route to this court. */
export interface CourtEligible {
  courtId: number;
  courtName: string; // short name for the UI chip
  billingCourtId: string; // billing.sud.uz Sud id
  billingReady: boolean; // billingCourtId is a real number (else invoices fall back to the default court)
  isPrimary: boolean; // order 0 — cases with no explicit courtId fall here
  eligible: number; // receiptNumber===null cases routed to this court
}

export interface FirmCourtProgress {
  firmId: number;
  firmName: string;
  total: number;
  withInvoice: number;
  eligible: number; // all kvitansiyasiz (sum across courts)
  courts: CourtEligible[]; // per-court split, primary first
}

/**
 * Per-firm, per-court eligible (kvitansiyasiz) case counts. Cases whose courtId is
 * still null are bucketed into the firm's PRIMARY court (that's where they route by
 * default). Firms with no configured courts get a single synthetic bucket (courtId 0)
 * so the UI still shows a total. Optionally scoped to one snapshot / firm.
 */
export async function invoiceProgressByCourt(snapshotId?: number, firmId?: number): Promise<FirmCourtProgress[]> {
  const scope = { ...(snapshotId ? { snapshotId } : {}), ...(firmId ? { firmId } : {}) };
  const [firms, totals, withInv, eligByCourt] = await Promise.all([
    prisma.firm.findMany({ where: firmId ? { id: firmId } : {}, select: { id: true, shortName: true } }),
    prisma.arizaCase.groupBy({ by: ['firmId'], where: scope, _count: { _all: true } }),
    prisma.arizaCase.groupBy({ by: ['firmId'], where: { ...scope, receiptNumber: { not: null } }, _count: { _all: true } }),
    // (firm × court) eligible counts — courtId may be null (→ primary bucket).
    prisma.arizaCase.groupBy({ by: ['firmId', 'courtId'], where: { ...scope, receiptNumber: null }, _count: { _all: true } }),
  ]);
  const totalBy = new Map(totals.map((t) => [t.firmId, t._count._all]));
  const invBy = new Map(withInv.map((t) => [t.firmId, t._count._all]));
  // firmId → (courtId|null) → count
  const eligBy = new Map<number, Map<number | null, number>>();
  for (const g of eligByCourt) {
    const m = eligBy.get(g.firmId) ?? new Map<number | null, number>();
    m.set(g.courtId, (m.get(g.courtId) ?? 0) + g._count._all);
    eligBy.set(g.firmId, m);
  }

  const withCases = firms.filter((f) => (totalBy.get(f.id) ?? 0) > 0);
  // Resolve each firm's ordered courts once (primary first). Guarded — missing config
  // must not crash the whole page.
  const courtsByFirm = new Map(
    await Promise.all(withCases.map(async (f) => [f.id, await firmCourtsOrdered(f.id).catch(() => [])] as const)),
  );

  const out: FirmCourtProgress[] = withCases.map((f) => {
    const total = totalBy.get(f.id) ?? 0;
    const withInvoice = invBy.get(f.id) ?? 0;
    const counts = eligBy.get(f.id) ?? new Map<number | null, number>();
    const eligible = [...counts.values()].reduce((s, n) => s + n, 0);
    const ordered = courtsByFirm.get(f.id) ?? [];
    const primaryId = ordered[0]?.id ?? null;

    const courts: CourtEligible[] = ordered.map((c, i) => {
      // The primary court also absorbs any not-yet-routed (courtId null) cases.
      const own = counts.get(c.id) ?? 0;
      const nulls = i === 0 ? counts.get(null) ?? 0 : 0;
      return {
        courtId: c.id,
        courtName: c.shortName,
        billingCourtId: c.billingCourtId,
        billingReady: /^\d+$/.test(c.billingCourtId),
        isPrimary: i === 0,
        eligible: own + nulls,
      };
    });
    // A firm with cases but NO configured court (routing disabled): single synthetic bucket.
    if (courts.length === 0 && eligible > 0) {
      courts.push({ courtId: 0, courtName: 'Sud belgilanmagan', billingCourtId: '', billingReady: false, isPrimary: true, eligible });
    }
    // Any eligible court not in the firm's ordered set (stale courtId) — surface it too, so it isn't lost.
    if (primaryId != null) {
      for (const [cid, n] of counts) {
        if (cid == null || cid === 0) continue;
        if (!courts.some((b) => b.courtId === cid)) {
          courts.push({ courtId: cid, courtName: `sud #${cid}`, billingCourtId: '', billingReady: false, isPrimary: false, eligible: n });
        }
      }
    }
    return { firmId: f.id, firmName: f.shortName, total, withInvoice, eligible, courts };
  });
  return out.sort((a, b) => b.total - a.total);
}

/** Global per-court totals across all firms (for the «Bright 400 · Yuqori Chirchiq 300» header). */
export interface CourtTotal { courtId: number; courtName: string; eligible: number; billingReady: boolean; }
export function courtTotalsFrom(firmProgress: FirmCourtProgress[]): CourtTotal[] {
  const by = new Map<number, CourtTotal>();
  for (const f of firmProgress) {
    for (const c of f.courts) {
      if (c.eligible <= 0) continue;
      const cur = by.get(c.courtId) ?? { courtId: c.courtId, courtName: c.courtName, eligible: 0, billingReady: c.billingReady };
      cur.eligible += c.eligible;
      by.set(c.courtId, cur);
    }
  }
  return [...by.values()].sort((a, b) => b.eligible - a.eligible);
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
