// Bulk talabnoma loader shared by the Talabnoma step-page's two exports: the reyestr
// Excel (one row per client) and the PDF ZIP (one letter per client). Both work on the
// SAME scope — one firm × one snapshot — because a xat.hippo reyestr is uploaded per firm
// (one letterhead, one account), so a mixed-firm batch would never be importable there.
//
// Reuses the single-case join + grouping (buildTalabnomaRows) so the bulk documents are
// byte-for-byte the same shape as «gen-talabnoma»/«gen-talabnoma-excel», just batched and
// with a running contract_id sequence across the whole reyestr.
import type { CaseStage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { buildTalabnomaRows, type TalabnomaLoan, type TalabnomaRow } from './talabnoma-excel';
import type { TalabnomaFirm } from './talabnoma-pdf';

export interface TalabnomaScope {
  snapshotId: number;
  firmId: number;
  stages?: CaseStage[];
}

export interface TalabnomaScopeResult {
  rows: TalabnomaRow[];              // debt-gated (total_debt > 0), one per client × firm
  firm: TalabnomaFirm | null;        // letterhead firm for every PDF in this batch
  firmShort: string;                 // safe-ish short name for filenames
  docDate: Date;
  paidPinfls: string[];              // PINFLs whose grouped debt > 0 — the funnel-mark set
}

/**
 * Load the talabnoma rows for every case of ONE firm in ONE snapshot, in reyestr order.
 * @throws if the firm or snapshot is missing — the caller turns that into a 4xx.
 */
export async function loadTalabnomaRowsForScope({ snapshotId, firmId, stages }: TalabnomaScope): Promise<TalabnomaScopeResult> {
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { code: true, legalName: true, shortName: true, address: true, stir: true, bankAccount: true, mfo: true, phone: true },
  });
  if (!firm) throw new Error('Firma topilmadi');

  const snapshot = await prisma.snapshot.findUnique({ where: { id: snapshotId }, select: { reportDate: true } });
  if (!snapshot) throw new Error('Snapshot topilmadi');

  // Distinct debtors of this firm in this snapshot (optionally narrowed by stage). Talabnoma is
  // the parallel track, so the step-page passes no stages — this covers the whole firm.
  const cases = await prisma.arizaCase.findMany({
    where: { snapshotId, firmId, ...(stages && stages.length ? { stage: { in: stages } } : {}) },
    select: { pinfl: true },
    distinct: ['pinfl'],
  });
  const pinfls = cases.map((c) => c.pinfl).filter((p): p is string => !!p);
  if (pinfls.length === 0) return { rows: [], firm, firmShort: firm.shortName || firm.code || 'firma', docDate: snapshot.reportDate, paidPinfls: [] };

  // firm.code === arizaCase.kod === loan.branchCode, so scope the loans to this firm's branch —
  // exactly the join the single-case route uses (branchCode: ac.kod), just batched. Ordered by
  // (pinfl, branchCode) so each client's contracts are contiguous for buildTalabnomaRows.
  const loans = (await prisma.loan.findMany({
    where: { snapshotId, branchCode: firm.code, pinfl: { in: pinfls } },
    orderBy: [{ pinfl: 'asc' }, { branchCode: 'asc' }, { id: 'asc' }],
    select: {
      pinfl: true, branchCode: true, clientName: true, postAddress: true, postAddressUz: true,
      regionName: true, ldId: true, dateToCr: true, summKr: true, totalDebt: true, raw: true,
    },
  })) as TalabnomaLoan[];

  // Debt gate — mirrors the single-case «Qarzdorlik 0» refusal so a zero-debt client never gets a
  // talabnoma. Applied at the grouped-row level (a client's contracts summed).
  const rows = buildTalabnomaRows(loans, snapshot.reportDate).filter((r) => r.total_debt > 0);

  // The debt>0 clients, keyed by PINFL — the set the PDF job flags as talabnomaAt (funnel advance).
  // Rounded to match the row-level debt gate exactly; blank-PINFL debtors can't be keyed, so they
  // still get a letter/reyestr row but aren't funnel-marked (no reliable case identity).
  const debtByPinfl = new Map<string, number>();
  for (const l of loans) {
    const p = l.pinfl != null && String(l.pinfl).trim() !== '' ? String(l.pinfl) : null;
    if (!p) continue;
    debtByPinfl.set(p, (debtByPinfl.get(p) ?? 0) + (Number(l.totalDebt) || 0));
  }
  const paidPinfls = [...debtByPinfl.entries()].filter(([, d]) => Math.round(d) > 0).map(([p]) => p);

  return { rows, firm, firmShort: firm.shortName || firm.code || 'firma', docDate: snapshot.reportDate, paidPinfls };
}
