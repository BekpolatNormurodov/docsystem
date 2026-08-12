import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { EmptyState, ClickableRow, Pagination } from '@/ui';
import { formatSumDecimal } from '@/core/document';

const PAGE = 50;

// The heavy part of /mijozlar (a groupBy(pinfl,clientName) ORDER BY SUM(debt) over
// the whole snapshot) lives here so it can STREAM via <Suspense> — the page header
// + search filter paint immediately and the operator can search while this loads.
export async function MijozlarTable({ snapshotId, linkDate, date, q, digitsOnly, useFullText, page }: {
  snapshotId: number; linkDate: string; date: string; q: string; digitsOnly: boolean; useFullText: boolean; page: number;
}) {
  type Group = { pinfl: string | null; clientName: string | null; _count: number; _sum: { totalDebt: unknown } };
  let groups: Group[];
  let totalClients: number;

  if (useFullText) {
    const boolExpr = q.replace(/[+\-<>~*()"@]/g, ' ').trim().split(/\s+/).filter(Boolean).map((w) => `+${w}*`).join(' ');
    const passLike = `${q}%`;
    // A single `MATCH(...) OR passportSn LIKE` WHERE defeats the fulltext index — MySQL
    // full-scans the snapshot and evaluates MATCH per row (~35s at 160k loans). Instead
    // JOIN against a MATERIALIZED union of matched loan ids so each predicate uses its own
    // index (fulltext on clientName + the passportSn index), then group only the matched
    // rows. Measured 35,770ms → 85ms for a typical name search.
    const matched = Prisma.sql`JOIN (
      SELECT id FROM Loan WHERE snapshotId = ${snapshotId} AND MATCH(clientName) AGAINST(${boolExpr} IN BOOLEAN MODE)
      UNION SELECT id FROM Loan WHERE snapshotId = ${snapshotId} AND passportSn LIKE ${passLike}
    ) m ON m.id = l.id`;
    const [rows, cnt] = await Promise.all([
      prisma.$queryRaw<{ pinfl: string; clientName: string | null; cnt: bigint; debt: string }[]>`
        SELECT l.pinfl AS pinfl, l.clientName AS clientName, COUNT(*) AS cnt, SUM(l.totalDebt) AS debt
        FROM Loan l ${matched}
        GROUP BY l.pinfl, l.clientName ORDER BY debt DESC, l.pinfl ASC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (SELECT 1 FROM Loan l ${matched} GROUP BY l.pinfl, l.clientName) t`,
    ]);
    groups = rows.map((r) => ({ pinfl: r.pinfl, clientName: r.clientName, _count: Number(r.cnt), _sum: { totalDebt: r.debt } }));
    totalClients = Number(cnt[0]?.n ?? 0);
  } else {
    const qFilter = q
      ? digitsOnly
        ? { OR: [{ pinfl: { startsWith: q } }, { ldId: { startsWith: q } }] }
        : { OR: [{ clientName: { contains: q } }, { passportSn: { contains: q } }] }
      : {};
    const where = { snapshotId, ...qFilter };
    const cond = !q
      ? Prisma.sql`snapshotId = ${snapshotId}`
      : digitsOnly
        ? Prisma.sql`snapshotId = ${snapshotId} AND (pinfl LIKE ${`${q}%`} OR ldId LIKE ${`${q}%`})`
        : Prisma.sql`snapshotId = ${snapshotId} AND (clientName LIKE ${`%${q}%`} OR passportSn LIKE ${`%${q}%`})`;
    const [g, cnt] = await Promise.all([
      prisma.loan.groupBy({ by: ['pinfl', 'clientName'], where, _sum: { totalDebt: true }, _count: true, orderBy: [{ _sum: { totalDebt: 'desc' } }, { pinfl: 'asc' }], skip: (page - 1) * PAGE, take: PAGE }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (SELECT 1 FROM Loan WHERE ${cond} GROUP BY pinfl, clientName) t`,
    ]);
    groups = g.map((x) => ({ pinfl: x.pinfl, clientName: x.clientName, _count: x._count, _sum: { totalDebt: x._sum.totalDebt } }));
    totalClients = Number(cnt[0]?.n ?? 0);
  }

  const totalPages = Math.max(1, Math.ceil(totalClients / PAGE));
  const pagePinfls = groups.map((g) => g.pinfl).filter((p): p is string => Boolean(p));
  const exPinfls = new Set(
    (await prisma.loan.findMany({ where: { pinfl: { in: pagePinfls }, excluded: true, snapshotId }, select: { pinfl: true }, distinct: ['pinfl'] })).map((r) => r.pinfl),
  );

  const hrefPage = (n: number) => {
    const p = new URLSearchParams();
    p.set('date', date);
    if (q) p.set('q', q);
    p.set('page', String(n));
    return `/mijozlar?${p.toString()}`;
  };

  if (groups.length === 0) return <EmptyState title="Mijoz topilmadi" hint="Qidiruvni oʻzgartirib koʻring." />;

  return (
    <>
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
                    <span className="badge ml-2 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">sud roʻyxatida</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{g._count}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatSumDecimal(String(g._sum.totalDebt ?? 0))} soʻm</td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pages={totalPages} total={totalClients} perPage={PAGE} hrefFor={hrefPage} unit="mijoz" />
    </>
  );
}
