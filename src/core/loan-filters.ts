import type { Prisma } from '@prisma/client';

export interface LoanFilters {
  q?: string;
  branch?: string;
  minDebt?: number;
  fromDate?: string;
  page: number;
}

/** Parses a query-string-shaped record (e.g. Next's searchParams) into typed loan filters. */
export function parseLoanFilters(sp: Record<string, string | undefined>): LoanFilters {
  const page = Number(sp.page) || 1;
  return {
    q: sp.q || undefined,
    branch: sp.branch || undefined,
    minDebt: sp.minDebt ? Number(sp.minDebt) : undefined,
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
  if (f.branch) where.branchCode = f.branch;
  if (f.minDebt !== undefined) where.totalDebt = { gte: f.minDebt };
  if (f.fromDate) where.dateToCr = { gte: new Date(f.fromDate) };
  return where;
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
