import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { loansToAriza } from '@/core/ariza';
import { formatSumDecimal, dmy } from '@/core/document';
import { PageHeader, StatCard } from '@/ui';
import { ArizaPreview } from './ArizaPreview';
import { PersonFilters } from './PersonFilters';

export const dynamic = 'force-dynamic';

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: { date: string; pinfl: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // Validate the date segment before Prisma — malformed / impossible (2026-13-45,
  // 2026-02-30 rollover) → clean 404, not a 500 or the wrong day's data.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) notFound();
  const reportDate = new Date(params.date);
  if (Number.isNaN(reportDate.getTime()) || reportDate.toISOString().slice(0, 10) !== params.date) notFound();
  const snapshot = await prisma.snapshot.findUnique({
    where: { reportDate },
  });
  if (!snapshot) notFound();

  const c = (typeof searchParams.c === 'string' ? searchParams.c : '').trim();
  const firmSel = Array.isArray(searchParams.firm)
    ? searchParams.firm
    : searchParams.firm
      ? [searchParams.firm]
      : [];

  const [allLoans, firms, settings] = await Promise.all([
    prisma.loan.findMany({
      where: { snapshotId: snapshot.id, pinfl: params.pinfl },
      orderBy: { totalDebt: 'desc' },
    }),
    prisma.firm.findMany(),
    getSettings(),
  ]);
  if (allLoans.length === 0) notFound();

  const firmByCode = new Map(firms.map((fr) => [fr.code, fr]));

  // The person's own firms (for the filter chips), with a per-firm contract count.
  const personFirmsMap = new Map<string, number>();
  for (const l of allLoans) {
    const k = l.branchCode ?? '';
    if (k) personFirmsMap.set(k, (personFirmsMap.get(k) ?? 0) + 1);
  }
  const personFirms = [...personFirmsMap.entries()].map(([code, count]) => ({
    code,
    name: firmByCode.get(code)?.shortName ?? code,
    count,
  }));

  const loans = allLoans.filter((l) => {
    if (c && !(l.ldId ?? '').toLowerCase().includes(c.toLowerCase())) return false;
    if (firmSel.length && !firmSel.includes(l.branchCode ?? '')) return false;
    return true;
  });
  const first = allLoans[0]!;
  const isExcluded = allLoans.some((l) => l.excluded);
  const grandTotal = loans.reduce((sum, l) => sum + Number(l.totalDebt), 0);

  // Group loans by firm, preserving each firm's first appearance order.
  const byFirm = new Map<string, typeof loans>();
  for (const loan of loans) {
    const key = loan.branchCode ?? '';
    if (!byFirm.has(key)) byFirm.set(key, []);
    byFirm.get(key)!.push(loan);
  }

  return (
    <div>
      <PageHeader
        title={first.clientName || params.pinfl}
        subtitle={`PINFL: ${params.pinfl} · Sana: ${params.date.split('-').reverse().join('.')}`}
        action={
          <Link href={`/s/${params.date}`} className="btn-ghost text-xs">
            ← Portfelga qaytish
          </Link>
        }
      />

      {isExcluded && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">⚖ Sudga xat berilgan</span>
          <span className="text-xs text-muted">— sud roʻyxatiga kiritilgan mijoz</span>
        </div>
      )}

      <PersonFilters initialC={c} firms={personFirms} initialFirms={firmSel} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Jami qarz" value={`${formatSumDecimal(String(grandTotal))} soʻm`} />
        <StatCard label="Kreditlar" value={loans.length} />
        <StatCard label="Firmalar" value={byFirm.size} />
      </div>

      <div className="card mb-4 p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">F.I.O.</dt>
            <dd className="mt-0.5 font-medium">{first.clientName || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Telefon</dt>
            <dd className="mt-0.5 font-medium">{first.phone || '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted">Manzil</dt>
            <dd className="mt-0.5 font-medium">{first.postAddressUz || first.postAddress || '—'}</dd>
          </div>
        </dl>
      </div>

      {loans.length === 0 && (
        <div className="card mb-4 p-5 text-sm text-muted">Shartnoma raqami boʻyicha kredit topilmadi.</div>
      )}

      <div className="space-y-6">
          {[...byFirm.entries()].map(([branchCode, firmLoans]) => {
            const firm = firmByCode.get(branchCode);
            const firmTotal = firmLoans.reduce((sum, l) => sum + Number(l.totalDebt), 0);
            return (
              <section key={branchCode || 'unknown'} className="card p-5">
                <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
                  <h2 className="font-semibold">
                    {firm?.shortName ?? branchCode ?? 'Nomaʼlum firma'}
                    <span className="ml-2 text-xs font-normal text-muted">· {firmLoans.length} ta shartnoma</span>
                  </h2>
                  <span className="rounded-lg bg-brand-600/10 px-3 py-1 text-sm font-bold tabular-nums text-brand-700 dark:text-brand-300">
                    Jami: {formatSumDecimal(String(firmTotal))} soʻm
                  </span>
                </header>

                <ul className="mb-4 space-y-2">
                  {firmLoans.map((loan) => (
                    <li key={loan.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                      <span>
                        <span className="font-medium">{loan.ldId || '—'}</span>
                        {loan.dateToCr && <span className="ml-2 text-xs text-muted">{dmy(loan.dateToCr)}</span>}
                      </span>
                      <span className="font-semibold tabular-nums">{formatSumDecimal(String(loan.totalDebt))} soʻm</span>
                    </li>
                  ))}
                </ul>

                {firm && (
                  <div>
                    <div className="mb-2 flex justify-end">
                      <a href={`/api/ariza/${firmLoans[0]!.id}`} className="btn-primary text-xs">
                        .docx — birlashtirilgan ariza
                      </a>
                    </div>
                    <ArizaPreview props={loansToAriza(firmLoans, firm, settings, snapshot.reportDate)} />
                  </div>
                )}
              </section>
            );
          })}
      </div>
    </div>
  );
}
