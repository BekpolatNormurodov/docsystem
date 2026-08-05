import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState, ClickableRow } from '@/ui';
import { formatSumDecimal } from '@/core/document';
import { MijozlarFilters } from './MijozlarFilters';

export const dynamic = 'force-dynamic';
const PAGE = 50;

/** Windowed page list: 1 … (cur-1) cur (cur+1) … last, with `null` marking an ellipsis gap. */
function pageWindow(cur: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const nums = new Set<number>([1, total, cur - 1, cur, cur + 1]);
  const sorted = [...nums].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev > 1) out.push(null);
    out.push(n);
    prev = n;
  }
  return out;
}

export default async function MijozlarPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  await requireAdmin();

  const snapshots = await prisma.snapshot.findMany({
    where: { status: 'READY' },
    orderBy: { reportDate: 'desc' },
    select: { id: true, reportDate: true },
  });

  if (snapshots.length === 0) {
    return (
      <div>
        <PageHeader title="Mijozlar" subtitle="Portfeldagi mijozlar (PINFL boʻyicha)" />
        <EmptyState title="Hali portfel yuklanmagan" hint="Import boʻlimidan portfel faylini yuklang." />
      </div>
    );
  }

  const dates = snapshots.map((s) => s.reportDate.toISOString().slice(0, 10));
  const latestDate = dates[0];
  // 'all' spans every snapshot; a real date restricts to that one.
  const date =
    searchParams.date === 'all'
      ? 'all'
      : searchParams.date && dates.includes(searchParams.date)
        ? searchParams.date
        : latestDate;
  const q = (searchParams.q ?? '').trim();
  const page = Math.max(1, Number(searchParams.page) || 1);

  const snapshot =
    date === 'all' ? null : await prisma.snapshot.findUnique({ where: { reportDate: new Date(`${date}T00:00:00.000Z`) } });
  const linkDate = date === 'all' ? latestDate : date;

  const qFilter = q
    ? {
        OR: [
          { pinfl: { contains: q } },
          { clientName: { contains: q } },
          { passportSn: { contains: q } },
          { ldId: { contains: q } },
        ],
      }
    : {};

  type Group = { pinfl: string | null; clientName: string | null; _count: number; _sum: { totalDebt: unknown } };
  let groups: Group[];
  let totalClients: number;

  if (date === 'all') {
    // One row per client from their LATEST snapshot — avoids double-counting a re-uploaded portfolio.
    const idsSql = Prisma.join(snapshots.map((s) => s.id));
    const qCond = q
      ? Prisma.sql`AND (l.pinfl LIKE ${`%${q}%`} OR l.clientName LIKE ${`%${q}%`} OR l.passportSn LIKE ${`%${q}%`} OR l.ldId LIKE ${`%${q}%`})`
      : Prisma.empty;
    const join = Prisma.sql`JOIN (SELECT pinfl, MAX(snapshotId) AS sid FROM Loan WHERE snapshotId IN (${idsSql}) GROUP BY pinfl) m ON l.pinfl = m.pinfl AND l.snapshotId = m.sid`;
    const [rows, cnt] = await Promise.all([
      prisma.$queryRaw<{ pinfl: string; clientName: string | null; cnt: bigint; debt: string }[]>`
        SELECT l.pinfl AS pinfl, l.clientName AS clientName, COUNT(*) AS cnt, SUM(l.totalDebt) AS debt
        FROM Loan l ${join} WHERE 1=1 ${qCond}
        GROUP BY l.pinfl, l.clientName ORDER BY debt DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (SELECT l.pinfl FROM Loan l ${join} WHERE 1=1 ${qCond} GROUP BY l.pinfl) t`,
    ]);
    groups = rows.map((r) => ({ pinfl: r.pinfl, clientName: r.clientName, _count: Number(r.cnt), _sum: { totalDebt: r.debt } }));
    totalClients = Number(cnt[0]?.n ?? 0);
  } else {
    const where = { snapshotId: snapshot!.id, ...qFilter };
    const [g, all] = await Promise.all([
      prisma.loan.groupBy({
        by: ['pinfl', 'clientName'],
        where,
        _sum: { totalDebt: true },
        _count: true,
        orderBy: { _sum: { totalDebt: 'desc' } },
        skip: (page - 1) * PAGE,
        take: PAGE,
      }),
      prisma.loan.groupBy({ by: ['pinfl'], where }),
    ]);
    groups = g.map((x) => ({ pinfl: x.pinfl, clientName: x.clientName, _count: x._count, _sum: { totalDebt: x._sum.totalDebt } }));
    totalClients = all.length;
  }
  const totalPages = Math.max(1, Math.ceil(totalClients / PAGE));

  const pagePinfls = groups.map((g) => g.pinfl).filter((p): p is string => Boolean(p));
  const exPinfls = new Set(
    (
      await prisma.loan.findMany({
        where: { pinfl: { in: pagePinfls }, excluded: true, ...(snapshot ? { snapshotId: snapshot.id } : { snapshot: { status: 'READY' } }) },
        select: { pinfl: true },
        distinct: ['pinfl'],
      })
    ).map((r) => r.pinfl),
  );

  const hrefPage = (n: number) => {
    const p = new URLSearchParams();
    p.set('date', date);
    if (q) p.set('q', q);
    p.set('page', String(n));
    return `/mijozlar?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Mijozlar"
        subtitle={`${totalClients.toLocaleString('ru-RU')} mijoz — qidiring va kartasiga kiring`}
      />

      <MijozlarFilters dates={dates} date={date} initialQ={q} />

      {groups.length === 0 ? (
        <EmptyState title="Mijoz topilmadi" hint="Qidiruvni oʻzgartirib koʻring." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">PINFL</th>
                <th className="px-4 py-3 font-medium">F.I.Sh</th>
                <th className="px-4 py-3 text-right font-medium">Shartnoma</th>
                <th className="px-4 py-3 text-right font-medium">Umumiy qarz</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <ClickableRow key={g.pinfl ?? Math.random()} href={`/s/${linkDate}/p/${g.pinfl}`}>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{g.pinfl}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{g.clientName}</span>
                    {g.pinfl && exPinfls.has(g.pinfl) && (
                      <span className="badge ml-2 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
                        sud roʻyxatida
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g._count}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {formatSumDecimal(String(g._sum.totalDebt ?? 0))} soʻm
                  </td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-sm">
          {pageWindow(page, totalPages).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="px-1 text-muted">
                …
              </span>
            ) : (
              <Link
                key={n}
                href={hrefPage(n)}
                aria-current={n === page ? 'page' : undefined}
                className={`min-w-9 rounded-lg border px-3 py-1.5 text-center transition ${
                  n === page ? 'border-brand-600 bg-brand-600 font-semibold text-white' : 'border-line hover:bg-surface-2'
                }`}
              >
                {n}
              </Link>
            ),
          )}
        </nav>
      )}
      <p className="mt-3 text-center text-xs text-muted">
        {totalClients.toLocaleString('ru-RU')} mijoz · {totalPages.toLocaleString('ru-RU')} sahifa
      </p>
    </div>
  );
}
