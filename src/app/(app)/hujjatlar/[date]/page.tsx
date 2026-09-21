import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { canManageDocs } from '@/lib/access';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState, Pagination } from '@/ui';
import { formatSumDecimal } from '@/core/document';
import { buildLoanWhere } from '@/core/loan-filters';
import { firmActivity } from '@/lib/active-firms';
import { getAppDoc } from '@/lib/app-docs';
import { getT } from '@/lib/i18n/server';
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
  const user = await requireUser();
  const canManage = canManageDocs(user);
  const t = getT();
  const date = params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  // Shape alone isn't enough: 2024-13-45 is an Invalid Date and 2024-02-30 rolls
  // forward to Mar 1 — both must 404, not 500 or render a different day's portfolio.
  const reportDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(reportDate.getTime()) || reportDate.toISOString().slice(0, 10) !== date) notFound();

  const snapshot = await prisma.snapshot.findUnique({
    where: { reportDate },
  });
  if (!snapshot) notFound();

  const q = (typeof searchParams.q === 'string' ? searchParams.q : '').trim();
  const branches = asArray(searchParams.branch);
  // Guard so a bad minDebt/page can't reach Prisma as NaN / a fractional skip and 500 the page.
  const md = typeof searchParams.minDebt === 'string' && searchParams.minDebt ? Number(searchParams.minDebt) : NaN;
  const minDebt = Number.isFinite(md) && md >= 0 ? md : undefined;
  const rawPage = Math.floor(Number(searchParams.page));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  // `ex=1` flips the page to the excluded set: instead of dropping problem/carried-over clients,
  // it shows and exports ONLY them (a separate ZIP for the excluded 1054).
  const onlyExcluded = searchParams.ex === '1';

  // Base where (firm + search). minDebt filters by the CLIENT's TOTAL debt via `having` — matching
  // the sum shown on each card, not a single loan. `excluded` selects the normal vs the excluded set.
  const fa = await firmActivity(); // nofaol firma — chip, ro'yxat va eksportda ko'rinmaydi
  const where = { ...buildLoanWhere(snapshot.id, { q, branches, page: 1 }, fa.inactiveCodes), excluded: onlyExcluded };
  const having = minDebt !== undefined ? { totalDebt: { _sum: { gte: minDebt } } } : undefined;

  const [firms, allGroups, clients] = await Promise.all([
    prisma.firm.findMany({ where: { active: true }, select: { code: true, shortName: true } }),
    // Firm chip counts respect the current mode: «Barchasi» → whole portfolio, «Sud roʻyxati» → only
    // the court-list (excluded) contracts. So the chip numbers add up to the subtitle's total.
    prisma.loan.groupBy({ by: ['branchCode'], where: { snapshotId: snapshot.id, excluded: onlyExcluded, ...fa.loanWhere }, _count: true }),
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

  const hrefPage = (n: number | string) => {
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
  // 3 ta manba .xlsx — «Portfel», «Sud roʻyxati», «Talabnoma roʻyxati». Har biri diskda bo'lsa
  // kartachada yuklab olish tugmasi ko'rinadi. Faqat admin/docs-manage ko'radi.
  const sourceFiles = canManage
    ? await (async () => {
        const portfelAbs = path.join(process.cwd(), 'uploads', `${snapshot.id}.xlsx`);
        const sudAbs = path.join(process.cwd(), 'uploads', `${snapshot.id}-exclude.xlsx`);
        const tal = await getAppDoc('talabnoma');
        const safeStat = (p: string) => { try { return fs.statSync(p).size; } catch { return 0; } };
        return {
          portfel: { present: safeStat(portfelAbs) > 0, size: safeStat(portfelAbs) },
          sud: { present: safeStat(sudAbs) > 0, size: safeStat(sudAbs) },
          talabnoma: tal?.filePath
            ? { present: safeStat(tal.filePath) > 0, size: safeStat(tal.filePath), label: tal.label }
            : { present: false, size: 0, label: null },
        };
      })()
    : null;

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
        : t('Hammasi');
      return {
        id: j.id,
        createdLabel: stamp(j.createdAt),
        count: j.total,
        sizeLabel: humanSize(size),
        mode: p.onlyExcluded ? t('Sud roʻyxati') : t('Barchasi'),
        firms,
        q: p.q || undefined,
        minDebt: p.minDebt ? p.minDebt.toLocaleString('ru-RU') : undefined,
      };
    })
    .filter((x): x is ReadyExport => x !== null);

  return (
    <div>
      <Link href="/hujjatlar" className="mb-3 inline-block text-sm text-muted hover:text-fg">
        ← {t('Sanalar')}
      </Link>
      <PageHeader
        title={`${t('Hujjatlar')} — ${pretty}`}
        subtitle={
          onlyExcluded
            ? `${t('Faqat istisnodagilar')}: ${clientCount.toLocaleString('ru-RU')} ${t('mijoz')} · ${matchLoans.toLocaleString('ru-RU')} ${t('shartnoma')}`
            : `${clientCount.toLocaleString('ru-RU')} ${t('mijoz')} · ${matchLoans.toLocaleString('ru-RU')} ${t('shartnoma')} — ${t('firmalarni tanlang yoki filtrlab ZIP oling')}`
        }
      />

      {sourceFiles && (
        <div className="card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{t('Manba fayllar (3 ta .xlsx)')}</div>
              <div className="text-[11px] text-muted">{t('Import qilingan asl fayllar — kerak boʻlsa yuklab oling')}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([
              { k: 'portfel', n: 1, label: t('Portfel'), meta: sourceFiles.portfel, tone: 'brand' },
              { k: 'sud', n: 2, label: t('Sud roʻyxati'), meta: sourceFiles.sud, tone: 'amber' },
              { k: 'talabnoma', n: 3, label: t('Talabnoma roʻyxati'), meta: sourceFiles.talabnoma, tone: 'emerald' },
            ] as const).map(({ k, n, label, meta, tone }) => {
              const kb = meta.size > 0 ? meta.size >= 1024 * 1024 ? `${(meta.size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(meta.size / 1024)} KB` : '';
              const toneCls = tone === 'brand' ? 'text-brand-600' : tone === 'amber' ? 'text-amber-600' : 'text-emerald-600';
              return meta.present ? (
                <a
                  key={k}
                  href={`/api/snapshots/${snapshot.id}/xlsx/${k}`}
                  download
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 transition hover:border-brand-500/50 hover:bg-surface-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-md bg-surface-1 text-xs font-bold ${toneCls}`}>{n}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{label}</div>
                      <div className="text-[10px] text-muted">{kb} · .xlsx</div>
                    </div>
                  </div>
                  <span className="text-brand-600">↓</span>
                </a>
              ) : (
                <div key={k} className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-surface-1 px-3 py-2.5 opacity-60">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-surface-2 text-xs font-bold text-muted">{n}</span>
                  <div className="min-w-0">
                    <div className="truncate text-sm">{label}</div>
                    <div className="text-[10px] text-muted">{t('yuklanmagan')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <FilterExportBar
        date={date}
        firms={firmChips}
        initial={{ q, branches, minDebt: minDebt !== undefined ? String(minDebt) : '', onlyExcluded }}
        matchClients={clientCount}
        matchContracts={matchLoans}
      />

      <ExportsList items={readyExports} />

      {clients.length === 0 ? (
        <EmptyState title={t('Mijoz topilmadi')} hint={t('Filtr yoki qidiruvni oʻzgartirib koʻring.')} />
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
                  <span className="text-xs text-muted">{c._count} {t('ta shartnoma')}</span>
                  <span className="text-sm font-semibold">{formatSumDecimal(String(c._sum.totalDebt ?? 0))} {t('soʻm')}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Pagination page={page} pages={totalPages} total={clientCount} perPage={PAGE} hrefTemplate={hrefPage('__P__')} unit={t('mijoz')} />
    </div>
  );
}
