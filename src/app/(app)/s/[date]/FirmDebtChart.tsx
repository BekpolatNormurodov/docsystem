import { prisma } from '@/lib/db';
import { buildLoanWhere, type LoanFilters } from '@/core/loan-filters';
import { firmActivity } from '@/lib/active-firms';
import { HBarChart } from '@/ui';
import { getT } from '@/lib/i18n/server';

// The per-firm debt sum groupBy is the heaviest query on this page (full-scan +
// SUM until the Loan_cover_firm_debt index is pushed). Rendered as its own async
// component so it STREAMS in via <Suspense> — the page (stats + table) paints
// immediately instead of blocking on this chart.
export async function FirmDebtChart({ snapshotId, f, firmByCode }: {
  snapshotId: number; f: LoanFilters; firmByCode: Map<string, string>;
}) {
  const t = getT();
  const fa = await firmActivity();
  const byFirm = await prisma.loan.groupBy({ by: ['branchCode'], where: buildLoanWhere(snapshotId, f, fa.inactiveCodes), _sum: { totalDebt: true } });
  if (byFirm.length === 0) return null;
  return (
    <div className="mb-4">
      <HBarChart
        title={t('Firmalar boʻyicha qarz')}
        rows={byFirm
          .map((g) => ({ label: firmByCode.get(g.branchCode ?? '') ?? g.branchCode ?? t('Nomaʼlum'), value: Number(g._sum.totalDebt ?? 0) }))
          .sort((a, b) => b.value - a.value)}
      />
    </div>
  );
}
