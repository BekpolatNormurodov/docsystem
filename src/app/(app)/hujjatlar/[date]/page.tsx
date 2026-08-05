import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState } from '@/ui';
import { formatSumDecimal } from '@/core/document';
import { buildLoanWhere } from '@/core/loan-filters';
import { FilterExportBar } from './FilterExportBar';

export const dynamic = 'force-dynamic';
const PAGE = 24;

const asArray = (v: string | string[] | undefined): string[] => (!v ? [] : Array.isArray(v) ? v : [v]);

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

function PagerLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  const cls = 'min-w-9 rounded-lg border border-line px-3 py-1.5 text-center';
  if (disabled) return <span className={`${cls} opacity-40`}>{label}</span>;
  return (
    <Link href={href} className={`${cls} transition hover:bg-surface-2`}>
      {label}
    </Link>
  );
}

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

  // Base where (firm + search). minDebt filters by the CLIENT's TOTAL debt via `having` — matching
  // the sum shown on each card, not a single loan.
  const where = buildLoanWhere(snapshot.id, { q, branches, page: 1 });
  const having = minDebt !== undefined ? { totalDebt: { _sum: { gte: minDebt } } } : undefined;

  const [firms, allGroups, clients, clientTotals] = await Promise.all([
    prisma.firm.findMany({ select: { code: true, shortName: true } }),
    prisma.loan.groupBy({ by: ['branchCode'], where: { snapshotId: snapshot.id }, _count: true }),
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
    prisma.loan.groupBy({ by: ['pinfl'], where, having, _count: true }),
  ]);

  const clientCount = clientTotals.length;
  const matchLoans = clientTotals.reduce((sum, g) => sum + g._count, 0);
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
        where: { snapshotId: snapshot.id, pinfl: { in: pinfls }, ...(branches.length ? { branchCode: { in: branches } } : {}) },
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
    branches.forEach((b) => sp.append('branch', b));
    sp.set('page', String(n));
    return `/hujjatlar/${date}?${sp.toString()}`;
  };

  const pretty = date.split('-').reverse().join('.');

  return (
    <div>
      <Link href="/hujjatlar" className="mb-3 inline-block text-sm text-muted hover:text-fg">
        ← Sanalar
      </Link>
      <PageHeader
        title={`Hujjatlar — ${pretty}`}
        subtitle={`${clientCount.toLocaleString('ru-RU')} mijoz · ${matchLoans.toLocaleString('ru-RU')} shartnoma — firmalarni tanlang yoki filtrlab ZIP oling`}
      />

      <FilterExportBar
        date={date}
        firms={firmChips}
        initial={{ q, branches, minDebt: minDebt !== undefined ? String(minDebt) : '' }}
        matchClients={clientCount}
        matchContracts={matchLoans}
      />

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

      {totalPages > 1 && (
        <nav className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-sm">
          <PagerLink href={hrefPage(1)} disabled={page <= 1} label="«" />
          <PagerLink href={hrefPage(page - 1)} disabled={page <= 1} label="‹" />
          {pageWindow(page, totalPages).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="px-1 text-muted">…</span>
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
          <PagerLink href={hrefPage(page + 1)} disabled={page >= totalPages} label="›" />
          <PagerLink href={hrefPage(totalPages)} disabled={page >= totalPages} label="»" />
        </nav>
      )}
      <p className="mt-3 text-center text-xs text-muted">
        {clientCount.toLocaleString('ru-RU')} mijoz · {totalPages.toLocaleString('ru-RU')} sahifa
      </p>
    </div>
  );
}
