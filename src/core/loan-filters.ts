import { Prisma } from '@prisma/client';

export interface LoanFilters {
  q?: string;
  branch?: string;
  /** Multi-firm selection (export). Takes precedence over the single `branch`. */
  branches?: string[];
  minDebt?: number;
  fromDate?: string;
  page: number;
}

/** Parses a query-string-shaped record (e.g. Next's searchParams) into typed loan filters. */
export function parseLoanFilters(sp: Record<string, string | undefined>): LoanFilters {
  // Clamp to a positive integer — a negative/fractional page would make Prisma's
  // skip invalid and crash the listing.
  const rawPage = Math.floor(Number(sp.page));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  // Only pass a finite, non-negative minDebt — an unparseable value must not reach
  // Prisma as NaN (PrismaClientValidationError → page crash).
  const md = sp.minDebt != null && sp.minDebt !== '' ? Number(sp.minDebt) : NaN;
  return {
    q: sp.q || undefined,
    branch: sp.branch || undefined,
    minDebt: Number.isFinite(md) && md >= 0 ? md : undefined,
    fromDate: sp.fromDate || undefined,
    page,
  };
}

/** Turns parsed loan filters into a Prisma where clause, scoped to a snapshot. Empty filters omitted. */
export function buildLoanWhere(snapshotId: number, f: LoanFilters): Prisma.LoanWhereInput {
  const where: Prisma.LoanWhereInput = { snapshotId };
  if (f.q) {
    where.OR = [
      { pinfl: { contains: f.q } },
      { clientName: { contains: f.q } },
      { ldId: { contains: f.q } },
    ];
  }
  if (f.branches && f.branches.length > 0) where.branchCode = { in: f.branches };
  else if (f.branch) where.branchCode = f.branch;
  if (f.minDebt !== undefined && Number.isFinite(f.minDebt)) where.totalDebt = { gte: f.minDebt };
  if (f.fromDate) {
    const d = new Date(f.fromDate); // ignore an unparseable fromDate rather than crash Prisma
    if (!Number.isNaN(d.getTime())) where.dateToCr = { gte: d };
  }
  return where;
}

/** The same predicate as buildLoanWhere, as a raw SQL fragment — for a
 *  COUNT(DISTINCT pinfl) that must NOT transfer ~51k rows to Node just to count
 *  people. Keep in lockstep with buildLoanWhere above. */
export function loanWhereSql(snapshotId: number, f: Omit<LoanFilters, 'page'>): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`snapshotId = ${snapshotId}`];
  if (f.q) { const like = `%${f.q}%`; parts.push(Prisma.sql`(pinfl LIKE ${like} OR clientName LIKE ${like} OR ldId LIKE ${like})`); }
  if (f.branches && f.branches.length > 0) parts.push(Prisma.sql`branchCode IN (${Prisma.join(f.branches)})`);
  else if (f.branch) parts.push(Prisma.sql`branchCode = ${f.branch}`);
  if (f.minDebt !== undefined && Number.isFinite(f.minDebt)) parts.push(Prisma.sql`totalDebt >= ${f.minDebt}`);
  if (f.fromDate) { const d = new Date(f.fromDate); if (!Number.isNaN(d.getTime())) parts.push(Prisma.sql`dateToCr >= ${d}`); }
  return Prisma.join(parts, ' AND ');
}

/** Builds a page href from a base path, the current filters, and a patch (e.g. changing page). */
export function loanPageHref(base: string, f: LoanFilters, patch: Partial<LoanFilters>): string {
  const merged: LoanFilters = { ...f, ...patch };
  const params = new URLSearchParams();
  if (merged.q) params.set('q', merged.q);
  if (merged.branch) params.set('branch', merged.branch);
  if (merged.minDebt !== undefined) params.set('minDebt', String(merged.minDebt));
  if (merged.fromDate) params.set('fromDate', merged.fromDate);
  params.set('page', String(merged.page ?? 1));
  return `${base}?${params.toString()}`;
}
