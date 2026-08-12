import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { parseLoanFilters, buildLoanWhere, loanWhereSql, loanPageHref } from '@/core/loan-filters';
import { formatSumDecimal, dmy } from '@/core/document';
import { PageHeader, StatCard, Table, Pagination, EmptyState, ClickableRow } from '@/ui';
import { LoanFilters } from './LoanFilters';
import { FirmDebtChart } from './FirmDebtChart';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

export default async function SnapshotBrowsePage({
  params,
  searchParams,
}: {
  params: { date: string };
  searchParams: Record<string, string | undefined>;
}) {
  // Validate the date segment before it reaches Prisma — a malformed /s/garbage
  // must be a clean 404, not an Invalid-Date 500.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) notFound();
  // Shape alone isn't enough: /s/2024-13-45 is an Invalid Date and /s/2024-02-30
  // rolls forward to Mar 1 — both must 404, not 500 or render the wrong day.
  const reportDate = new Date(params.date);
  if (Number.isNaN(reportDate.getTime()) || reportDate.toISOString().slice(0, 10) !== params.date) notFound();
  const snapshot = await prisma.snapshot.findUnique({
    where: { reportDate },
  });
  if (!snapshot) notFound();

  const f = parseLoanFilters(searchParams);
  const where = buildLoanWhere(snapshot.id, f);

  const [loans, total, sumAgg, peopleCount, firms] = await Promise.all([
    prisma.loan.findMany({
      where,
      skip: (f.page - 1) * PER_PAGE,
      take: PER_PAGE,
      orderBy: { totalDebt: 'desc' },
    }),
    prisma.loan.count({ where }),
    prisma.loan.aggregate({ where, _sum: { totalDebt: true } }),
    // Distinct people (pinfl) matching the filter — a scalar COUNT(DISTINCT) instead
    // of transferring ~63k pinfl rows to Node just to read .length.
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT pinfl) AS n FROM Loan WHERE ${loanWhereSql(snapshot.id, f)}`,
    prisma.firm.findMany(),
  ]);
  const peopleTotal = Number(peopleCount[0]?.n ?? 0);
  // The per-firm debt chart (heaviest query) is NOT awaited here — it streams via
  // <Suspense> below so the stats + table paint immediately.

  const firmByCode = new Map(firms.map((fr) => [fr.code, fr.shortName]));

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const base = `/s/${params.date}`;

  return (
    <div>
      <PageHeader title={`Portfel — ${dmy(snapshot.reportDate)}`} subtitle={snapshot.sourceFileName} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Jami qarz" value={`${formatSumDecimal(String(sumAgg._sum.totalDebt ?? 0))} soʻm`} />
        <StatCard label="Kreditlar" value={total.toLocaleString('uz')} />
        <StatCard label="Odamlar" value={peopleTotal.toLocaleString('uz')} />
      </div>

      <Suspense fallback={<div className="mb-4 h-40 w-full animate-pulse rounded-2xl bg-surface-2" />}>
        <FirmDebtChart snapshotId={snapshot.id} f={f} firmByCode={firmByCode} />
      </Suspense>

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
                <td className="px-4 py-3">
                  {loan.clientName || '—'}
                  {loan.excluded && (
                    <span className="badge border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300 text-[10px] ml-2">
                      istisno
                    </span>
                  )}
                </td>
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
