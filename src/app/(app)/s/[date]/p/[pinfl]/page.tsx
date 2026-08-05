import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { loanToAriza } from '@/core/ariza';
import { formatSumDecimal, dmy } from '@/core/document';
import { PageHeader, StatCard } from '@/ui';
import { ArizaPreview } from './ArizaPreview';

export const dynamic = 'force-dynamic';

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: { date: string; pinfl: string };
  searchParams: Record<string, string | undefined>;
}) {
  const snapshot = await prisma.snapshot.findUnique({
    where: { reportDate: new Date(params.date) },
  });
  if (!snapshot) notFound();

  const c = (searchParams.c ?? '').trim();

  const [allLoans, firms, settings] = await Promise.all([
    prisma.loan.findMany({
      where: { snapshotId: snapshot.id, pinfl: params.pinfl },
      orderBy: { totalDebt: 'desc' },
    }),
    prisma.firm.findMany(),
    getSettings(),
  ]);
  if (allLoans.length === 0) notFound();

  const loans = c ? allLoans.filter((l) => (l.ldId ?? '').toLowerCase().includes(c.toLowerCase())) : allLoans;

  const firmByCode = new Map(firms.map((fr) => [fr.code, fr]));
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

      <form method="get" className="mb-4 max-w-sm">
        <label className="block">
          <span className="field-label">Shartnoma raqami boʻyicha qidirish</span>
          <input name="c" defaultValue={c} placeholder="masalan: 12345" className="field-input w-full" />
        </label>
      </form>

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
            <dd className="mt-0.5 font-medium">{first.postAddress || '—'}</dd>
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
                <header className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-semibold">{firm?.shortName ?? branchCode ?? 'Nomaʼlum firma'}</h2>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatSumDecimal(String(firmTotal))} soʻm
                  </span>
                </header>

                <div className="space-y-4">
                  {firmLoans.map((loan) => (
                    <div key={loan.id} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm">
                          <span className="font-medium">{loan.ldId || '—'}</span>
                          {loan.dateToCr && (
                            <span className="ml-2 text-xs text-muted">{dmy(loan.dateToCr)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold tabular-nums">
                            {formatSumDecimal(String(loan.totalDebt))} soʻm
                          </span>
                          <a
                            href={`/api/ariza/${loan.id}`}
                            className="btn-ghost text-xs"
                          >
                            .docx
                          </a>
                        </div>
                      </div>

                      {firm && (
                        <div className="mt-3">
                          <ArizaPreview props={loanToAriza(loan, firm, settings, snapshot.reportDate)} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
      </div>
    </div>
  );
}
