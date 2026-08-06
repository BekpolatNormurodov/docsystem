import { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState, ClickableRow, Pagination } from '@/ui';
import { formatSumDecimal } from '@/core/document';
import { MijozlarFilters } from './MijozlarFilters';

export const dynamic = 'force-dynamic';
const PAGE = 50;

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
  // Default is "Hamma sana" (all snapshots); a real date restricts to that one.
  const date = searchParams.date && dates.includes(searchParams.date) ? searchParams.date : 'all';
  const rawQ = (searchParams.q ?? '').trim();
  // Ignore 1-char queries: too unselective to scan 100k+ rows for, and they feel laggy.
  const q = rawQ.length >= 2 ? rawQ : '';
  // Digit-only queries are ID lookups (PINFL / contract): prefix-match the indexed id columns — fast.
  // Text queries hit the name/passport columns with a substring match.
  const digitsOnly = /^\d+$/.test(q);
  const page = Math.max(1, Number(searchParams.page) || 1);

  // "Hamma sana" resolves to the newest portfolio (snapshots are full per-date dumps, ordered desc),
  // so a single indexed snapshot groupBy serves both modes — sub-second, no cross-snapshot self-join.
  const snapshot =
    date === 'all'
      ? await prisma.snapshot.findUnique({ where: { id: snapshots[0]!.id } })
      : await prisma.snapshot.findUnique({ where: { reportDate: new Date(`${date}T00:00:00.000Z`) } });
  const linkDate = date === 'all' ? latestDate : date;

  type Group = { pinfl: string | null; clientName: string | null; _count: number; _sum: { totalDebt: unknown } };
  let groups: Group[];
  let totalClients: number;

  // Name search uses a FULLTEXT index (MATCH … AGAINST) — ~30ms vs ~8s for a `%substring%` scan.
  // Needs ≥3 chars (InnoDB min token size); shorter or digit queries take the indexed groupBy path.
  const useFullText = !!q && !digitsOnly && q.length >= 3;

  if (useFullText) {
    // Each token as a required prefix term: "kaniza" → "+kaniza*", "ali val" → "+ali* +val*".
    const boolExpr = q
      .replace(/[+\-<>~*()"@]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `+${w}*`)
      .join(' ');
    const sid = snapshot!.id;
    const passLike = `${q}%`;
    const cond = Prisma.sql`l.snapshotId = ${sid} AND (MATCH(l.clientName) AGAINST(${boolExpr} IN BOOLEAN MODE) OR l.passportSn LIKE ${passLike})`;
    const [rows, cnt] = await Promise.all([
      prisma.$queryRaw<{ pinfl: string; clientName: string | null; cnt: bigint; debt: string }[]>`
        SELECT l.pinfl AS pinfl, l.clientName AS clientName, COUNT(*) AS cnt, SUM(l.totalDebt) AS debt
        FROM Loan l WHERE ${cond}
        GROUP BY l.pinfl, l.clientName ORDER BY debt DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT l.pinfl) AS n FROM Loan l WHERE ${cond}`,
    ]);
    groups = rows.map((r) => ({ pinfl: r.pinfl, clientName: r.clientName, _count: Number(r.cnt), _sum: { totalDebt: r.debt } }));
    totalClients = Number(cnt[0]?.n ?? 0);
  } else {
    const sid = snapshot!.id;
    const qFilter = q
      ? digitsOnly
        ? { OR: [{ pinfl: { startsWith: q } }, { ldId: { startsWith: q } }] }
        : { OR: [{ clientName: { contains: q } }, { passportSn: { contains: q } }] }
      : {};
    const where = { snapshotId: sid, ...qFilter };
    // Count distinct clients cheaply — COUNT(DISTINCT) never transfers the ~51k pinfl rows a
    // groupBy would. The WHERE mirrors qFilter for each query shape.
    const cond = !q
      ? Prisma.sql`snapshotId = ${sid}`
      : digitsOnly
        ? Prisma.sql`snapshotId = ${sid} AND (pinfl LIKE ${`${q}%`} OR ldId LIKE ${`${q}%`})`
        : Prisma.sql`snapshotId = ${sid} AND (clientName LIKE ${`%${q}%`} OR passportSn LIKE ${`%${q}%`})`;
    const [g, cnt] = await Promise.all([
      prisma.loan.groupBy({
        by: ['pinfl', 'clientName'],
        where,
        _sum: { totalDebt: true },
        _count: true,
        orderBy: { _sum: { totalDebt: 'desc' } },
        skip: (page - 1) * PAGE,
        take: PAGE,
      }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT pinfl) AS n FROM Loan WHERE ${cond}`,
    ]);
    groups = g.map((x) => ({ pinfl: x.pinfl, clientName: x.clientName, _count: x._count, _sum: { totalDebt: x._sum.totalDebt } }));
    totalClients = Number(cnt[0]?.n ?? 0);
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

      <Pagination page={page} pages={totalPages} total={totalClients} perPage={PAGE} hrefFor={hrefPage} unit="mijoz" />
    </div>
  );
}
