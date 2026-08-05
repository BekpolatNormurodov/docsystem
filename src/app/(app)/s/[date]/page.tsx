import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { parseLoanFilters, buildLoanWhere, loanPageHref } from '@/core/loan-filters';
import { formatSumDecimal, dmy } from '@/core/document';
import { PageHeader, StatCard, HBarChart, Table, Pagination, EmptyState, ClickableRow } from '@/ui';
import { LoanFilters } from './LoanFilters';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

export default async function SnapshotBrowsePage({
  params,
  searchParams,
}: {
  params: { date: string };
  searchParams: Record<string, string | undefined>;
}) {
  const snapshot = await prisma.snapshot.findUnique({
    where: { reportDate: new Date(params.date) },
  });
  if (!snapshot) notFound();

  const f = parseLoanFilters(searchParams);
  const where = buildLoanWhere(snapshot.id, f);

  const [loans, total, sumAgg, byFirm, peopleGroups, firms] = await Promise.all([
    prisma.loan.findMany({
      where,
      skip: (f.page - 1) * PER_PAGE,
      take: PER_PAGE,
      orderBy: { totalDebt: 'desc' },
    }),
    prisma.loan.count({ where }),
    prisma.loan.aggregate({ where, _sum: { totalDebt: true } }),
    prisma.loan.groupBy({
      by: ['branchCode'],
      where,
      _sum: { totalDebt: true },
    }),
    // Distinct people (pinfl) matching the current filter — loans/count/sum above are per-loan.
    prisma.loan.groupBy({ by: ['pinfl'], where }),
    prisma.firm.findMany(),
  ]);

  const firmByCode = new Map(firms.map((fr) => [fr.code, fr.shortName]));

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const base = `/s/${params.date}`;

  return (
    <div>
      <PageHeader title={`Portfel — ${dmy(snapshot.reportDate)}`} subtitle={snapshot.sourceFileName} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Jami qarz" value={`${formatSumDecimal(String(sumAgg._sum.totalDebt ?? 0))} soʻm`} />
        <StatCard label="Kreditlar" value={total.toLocaleString('uz')} />
        <StatCard label="Odamlar" value={peopleGroups.length.toLocaleString('uz')} />
      </div>

      {byFirm.length > 0 && (
        <div className="mb-4">
          <HBarChart
            title="Firmalar boʻyicha qarz"
            rows={byFirm
              .map((g) => ({
                label: firmByCode.get(g.branchCode ?? '') ?? g.branchCode ?? 'Nomaʼlum',
                value: Number(g._sum.totalDebt ?? 0),
              }))
              .sort((a, b) => b.value - a.value)}
          />
        </div>
      )}

      <LoanFilters firms={firms.map((fr) => ({ code: fr.code, shortName: fr.shortName }))} />

      {loans.length === 0 ? (
        <EmptyState title="Kreditlar topilmadi" hint="Filtrlarni oʻzgartirib koʻring" />
      ) : (
        <>
          <Table
            head={
              <tr>
                <th className="px-4 py-3 text-left font-medium">PINFL</th>
                <th className="px-4 py-3 text-left font-medium">F.I.O.</th>
                <th className="px-4 py-3 text-left font-medium">Firma</th>
                <th className="px-4 py-3 text-left font-medium">Shartnoma</th>
                <th className="px-4 py-3 text-right font-medium">Qarz</th>
              </tr>
            }
          >
            {loans.map((loan) => (
              <ClickableRow key={loan.id} href={`${base}/p/${loan.pinfl ?? ''}`}>
                <td className="px-4 py-3">{loan.pinfl || '—'}</td>
                <td className="px-4 py-3">{loan.clientName || '—'}</td>
                <td className="px-4 py-3">{firmByCode.get(loan.branchCode ?? '') ?? loan.branchCode ?? '—'}</td>
                <td className="px-4 py-3">{loan.ldId || '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatSumDecimal(String(loan.totalDebt))}</td>
              </ClickableRow>
            ))}
          </Table>

          <Pagination
            page={f.page}
            pages={pages}
            total={total}
            perPage={PER_PAGE}
            hrefFor={(p) => loanPageHref(base, f, { page: p })}
          />
        </>
      )}
    </div>
  );
}
