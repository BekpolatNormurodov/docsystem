import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState, Pagination } from '@/ui';
import { formatSumDecimal } from '@/core/document';
import { buildLoanWhere } from '@/core/loan-filters';
import { FilterExportBar } from './FilterExportBar';
import { ExportsList, type ReadyExport } from './ExportsList';

/** Bytes → human size (KB/MB). */
function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Date → 'DD.MM.YYYY HH:mm' (local server time). */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const dynamic = 'force-dynamic';
const PAGE = 24;

const asArray = (v: string | string[] | undefined): string[] => (!v ? [] : Array.isArray(v) ? v : [v]);

export default async function HujjatlarDatePage({
  params,
  searchParams,
}: {
  params: { date: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await requireAdmin();
  const date = params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const snapshot = await prisma.snapshot.findUnique({
    where: { reportDate: new Date(`${date}T00:00:00.000Z`) },
  });
  if (!snapshot) notFound();

  const q = (typeof searchParams.q === 'string' ? searchParams.q : '').trim();
  const branches = asArray(searchParams.branch);
  const minDebt = typeof searchParams.minDebt === 'string' && searchParams.minDebt ? Number(searchParams.minDebt) : undefined;
  const page = Math.max(1, Number(searchParams.page) || 1);
  // `ex=1` flips the page to the excluded set: instead of dropping problem/carried-over clients,
  // it shows and exports ONLY them (a separate ZIP for the excluded 1054).
  const onlyExcluded = searchParams.ex === '1';

  // Base where (firm + search). minDebt filters by the CLIENT's TOTAL debt via `having` — matching
  // the sum shown on each card, not a single loan. `excluded` selects the normal vs the excluded set.
  const where = { ...buildLoanWhere(snapshot.id, { q, branches, page: 1 }), excluded: onlyExcluded };
  const having = minDebt !== undefined ? { totalDebt: { _sum: { gte: minDebt } } } : undefined;

  const [firms, allGroups, clients] = await Promise.all([
    prisma.firm.findMany({ select: { code: true, shortName: true } }),
    // Firm chip counts respect the current mode: «Barchasi» → whole portfolio, «Sud roʻyxati» → only
    // the court-list (excluded) contracts. So the chip numbers add up to the subtitle's total.
    prisma.loan.groupBy({ by: ['branchCode'], where: { snapshotId: snapshot.id, excluded: onlyExcluded }, _count: true }),
    prisma.loan.groupBy({
      by: ['pinfl', 'clientName'],
      where,
      having,
      _sum: { totalDebt: true },
      _count: true,
      orderBy: { _sum: { totalDebt: 'desc' } },
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
  ]);

  // Client + loan totals. Without a minDebt (having) filter this is a single COUNT(DISTINCT)/COUNT(*)
  // — never the ~51k-row groupBy transfer that made tab navigation drag. With minDebt, the per-client
  // total lives in a HAVING, so keep the grouped path.
  let clientCount: number;
  let matchLoans: number;
  if (having) {
    const totals = await prisma.loan.groupBy({ by: ['pinfl'], where, having, _count: true });
    clientCount = totals.length;
    matchLoans = totals.reduce((sum, g) => sum + g._count, 0);
  } else {
    const conds = [Prisma.sql`snapshotId = ${snapshot.id}`, Prisma.sql`excluded = ${onlyExcluded}`];
    if (branches.length) conds.push(Prisma.sql`branchCode IN (${Prisma.join(branches)})`);
    if (q) conds.push(Prisma.sql`(pinfl LIKE ${`%${q}%`} OR clientName LIKE ${`%${q}%`} OR ldId LIKE ${`%${q}%`})`);
    const cond = Prisma.join(conds, ' AND ');
    const r = await prisma.$queryRaw<{ clients: bigint; loans: bigint }[]>`SELECT COUNT(DISTINCT pinfl) AS clients, COUNT(*) AS loans FROM Loan WHERE ${cond}`;
    clientCount = Number(r[0]?.clients ?? 0);
    matchLoans = Number(r[0]?.loans ?? 0);
  }
  const totalPages = Math.max(1, Math.ceil(clientCount / PAGE));

  const nameByCode = new Map(firms.map((f) => [f.code, f.shortName]));
  const firmChips = allGroups
    .filter((g) => g.branchCode)
    .map((g) => ({ code: g.branchCode as string, name: nameByCode.get(g.branchCode as string) ?? (g.branchCode as string), count: g._count }))
    .sort((a, b) => b.count - a.count);

  // Which firms each client on this page has loans with (respecting the firm filter).
  const pinfls = clients.map((c) => c.pinfl).filter(Boolean) as string[];
  const pairs = pinfls.length
    ? await prisma.loan.findMany({
        where: { snapshotId: snapshot.id, pinfl: { in: pinfls }, excluded: onlyExcluded, ...(branches.length ? { branchCode: { in: branches } } : {}) },
        select: { pinfl: true, branchCode: true },
        distinct: ['pinfl', 'branchCode'],
      })
    : [];
  const firmsByPinfl = new Map<string, string[]>();
  for (const p of pairs) {
    if (!p.pinfl) continue;
    const arr = firmsByPinfl.get(p.pinfl) ?? [];
    if (p.branchCode && !arr.includes(p.branchCode)) arr.push(p.branchCode);
    firmsByPinfl.set(p.pinfl, arr);
  }

  const hrefPage = (n: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (minDebt !== undefined) sp.set('minDebt', String(minDebt));
    if (onlyExcluded) sp.set('ex', '1');
    branches.forEach((b) => sp.append('branch', b));
    sp.set('page', String(n));
    return `/hujjatlar/${date}?${sp.toString()}`;
  };

  const pretty = date.split('-').reverse().join('.');

  // Persisted finished exports for this snapshot — downloadable again, no re-generation needed.
  const exportJobs = await prisma.job.findMany({
    where: { type: 'EXPORT', status: 'DONE', snapshotId: snapshot.id },
    orderBy: { createdAt: 'desc' },
  });
  const readyExports: ReadyExport[] = exportJobs
    .map((j): ReadyExport | null => {
      // Drop rows whose ZIP was removed from disk so the list never offers a dead download.
      if (!j.resultPath) return null;
      const abs = path.join(process.cwd(), j.resultPath);
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        return null;
      }
      const p = (j.params ?? {}) as { branches?: string[]; q?: string; minDebt?: number; onlyExcluded?: boolean };
      const firms = p.branches && p.branches.length
        ? p.branches.map((c) => nameByCode.get(c) ?? c).join(', ')
        : 'Hammasi';
      return {
        id: j.id,
        createdLabel: stamp(j.createdAt),
        count: j.total,
        sizeLabel: humanSize(size),
        mode: p.onlyExcluded ? 'Sud roʻyxati' : 'Barchasi',
        firms,
        q: p.q || undefined,
        minDebt: p.minDebt ? p.minDebt.toLocaleString('ru-RU') : undefined,
      };
    })
    .filter((x): x is ReadyExport => x !== null);

  return (
    <div>
      <Link href="/hujjatlar" className="mb-3 inline-block text-sm text-muted hover:text-fg">
        ← Sanalar
      </Link>
      <PageHeader
        title={`Hujjatlar — ${pretty}`}
        subtitle={
          onlyExcluded
            ? `Faqat istisnodagilar: ${clientCount.toLocaleString('ru-RU')} mijoz · ${matchLoans.toLocaleString('ru-RU')} shartnoma`
            : `${clientCount.toLocaleString('ru-RU')} mijoz · ${matchLoans.toLocaleString('ru-RU')} shartnoma — firmalarni tanlang yoki filtrlab ZIP oling`
        }
      />

      <FilterExportBar
        date={date}
        firms={firmChips}
        initial={{ q, branches, minDebt: minDebt !== undefined ? String(minDebt) : '', onlyExcluded }}
        matchClients={clientCount}
        matchContracts={matchLoans}
      />

      <ExportsList items={readyExports} />

      {clients.length === 0 ? (
        <EmptyState title="Mijoz topilmadi" hint="Filtr yoki qidiruvni oʻzgartirib koʻring." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => {
            const codes = c.pinfl ? firmsByPinfl.get(c.pinfl) ?? [] : [];
            return (
              <Link
                key={c.pinfl ?? Math.random()}
                href={`/s/${date}/p/${c.pinfl}`}
                className="card group flex flex-col gap-2 p-4 transition hover:border-brand-500/50 hover:shadow-glow"
              >
                <div className="font-semibold leading-tight group-hover:text-brand-600">{c.clientName}</div>
                <div className="font-mono text-xs text-muted">{c.pinfl}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {codes.map((code) => (
                    <span key={code} className="badge border-line bg-surface-2 text-[10px]">
                      {nameByCode.get(code) ?? code}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex items-end justify-between border-t border-line pt-2">
                  <span className="text-xs text-muted">{c._count} ta shartnoma</span>
                  <span className="text-sm font-semibold">{formatSumDecimal(String(c._sum.totalDebt ?? 0))} soʻm</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Pagination page={page} pages={totalPages} total={clientCount} perPage={PAGE} hrefFor={hrefPage} unit="mijoz" />
    </div>
  );
}
