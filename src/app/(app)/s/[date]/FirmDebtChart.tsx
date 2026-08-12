import { prisma } from '@/lib/db';
import { buildLoanWhere, type LoanFilters } from '@/core/loan-filters';
import { HBarChart } from '@/ui';

// The per-firm debt sum groupBy is the heaviest query on this page (full-scan +
// SUM until the Loan_cover_firm_debt index is pushed). Rendered as its own async
// component so it STREAMS in via <Suspense> — the page (stats + table) paints
// immediately instead of blocking on this chart.
export async function FirmDebtChart({ snapshotId, f, firmByCode }: {
  snapshotId: number; f: LoanFilters; firmByCode: Map<string, string>;
}) {
  const byFirm = await prisma.loan.groupBy({ by: ['branchCode'], where: buildLoanWhere(snapshotId, f), _sum: { totalDebt: true } });
  if (byFirm.length === 0) return null;
  return (
    <div className="mb-4">
      <HBarChart
        title="Firmalar boʻyicha qarz"
        rows={byFirm
          .map((g) => ({ label: firmByCode.get(g.branchCode ?? '') ?? g.branchCode ?? 'Nomaʼlum', value: Number(g._sum.totalDebt ?? 0) }))
          .sort((a, b) => b.value - a.value)}
      />
    </div>
  );
}
