import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState } from '@/ui';
import { formatSumDecimal } from '@/core/document';

export const dynamic = 'force-dynamic';
const PAGE = 50;

const pretty = (d: string) => d.split('-').reverse().join('.');

export default async function MijozlarPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  await requireAdmin();

  const snapshots = await prisma.snapshot.findMany({
    where: { status: 'READY' },
    orderBy: { reportDate: 'desc' },
    select: { reportDate: true },
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
  const date = searchParams.date && dates.includes(searchParams.date) ? searchParams.date : dates[0];
  const q = (searchParams.q ?? '').trim();
  const page = Math.max(1, Number(searchParams.page) || 1);

  const snapshot = await prisma.snapshot.findUnique({
    where: { reportDate: new Date(`${date}T00:00:00.000Z`) },
  });

  const where = {
    snapshotId: snapshot!.id,
    ...(q
      ? { OR: [{ pinfl: { contains: q } }, { clientName: { contains: q } }, { passportSn: { contains: q } }] }
      : {}),
  };

  // One row per client (pinfl), with their loan count and total debt across all firms in this snapshot.
  const groups = await prisma.loan.groupBy({
    by: ['pinfl', 'clientName'],
    where,
    _sum: { totalDebt: true },
    _count: true,
    orderBy: { _sum: { totalDebt: 'desc' } },
    skip: (page - 1) * PAGE,
    take: PAGE,
  });

  const hrefWith = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    p.set('date', date);
    if (q) p.set('q', q);
    p.set('page', String(patch.page ?? page));
    return `/mijozlar?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Mijozlar" subtitle="Portfeldagi mijozlar (PINFL boʻyicha) — qidiring va kartasiga kiring" />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="field-label">Sana</span>
          <select name="date" defaultValue={date} className="field-input min-w-[160px]">
            {dates.map((d) => (
              <option key={d} value={d}>
                {pretty(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="block flex-1">
          <span className="field-label">Qidiruv (PINFL, F.I.Sh, passport)</span>
          <input name="q" defaultValue={q} placeholder="masalan: 3210… yoki ABDULLAYEV" className="field-input w-full" />
        </label>
        <button type="submit" className="btn-primary">
          Qidirish
        </button>
      </form>

      {groups.length === 0 ? (
        <EmptyState title="Mijoz topilmadi" hint="Qidiruvni oʻzgartirib koʻring." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">PINFL</th>
                <th className="px-4 py-3 font-medium">F.I.Sh</th>
                <th className="px-4 py-3 text-right font-medium">Kreditlar</th>
                <th className="px-4 py-3 text-right font-medium">Umumiy qarz</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.pinfl ?? Math.random()} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2.5 font-mono text-xs">
                    <Link href={`/s/${date}/p/${g.pinfl}`} className="hover:underline">
                      {g.pinfl}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/s/${date}/p/${g.pinfl}`} className="font-medium hover:underline">
                      {g.clientName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-right">{g._count}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">
                    {formatSumDecimal(String(g._sum.totalDebt ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-sm">
        {page > 1 ? (
          <Link href={hrefWith({ page: page - 1 })} className="btn-ghost">
            ← Oldingi
          </Link>
        ) : (
          <span />
        )}
        <span className="text-muted">Sahifa {page}</span>
        {groups.length === PAGE ? (
          <Link href={hrefWith({ page: page + 1 })} className="btn-ghost">
            Keyingi →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
