import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState, Skeleton } from '@/ui';
import { MijozlarFilters } from './MijozlarFilters';
import { MijozlarTable } from './MijozlarTable';

export const dynamic = 'force-dynamic';

export default async function MijozlarPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  await requireUser();

  const snapshots = await prisma.snapshot.findMany({
    where: { status: 'READY' },
    orderBy: { reportDate: 'desc' },
    select: { id: true, reportDate: true },
  });

  if (snapshots.length === 0) {
    return (
      <div>
        <PageHeader title="Mijozlar" subtitle="Portfeldagi mijozlar (PINFL boʻyicha)" />
        <EmptyState title="Hali portfel yuklanmagan" hint="Hujjatlar boʻlimidan portfel faylini yuklang." />
      </div>
    );
  }

  const dates = snapshots.map((s) => s.reportDate.toISOString().slice(0, 10));
  const latestDate = dates[0];
  // Default is "Hamma sana" (all snapshots); a real date restricts to that one.
  const date = searchParams.date && dates.includes(searchParams.date) ? searchParams.date : 'all';
  const rawQ = (searchParams.q ?? '').trim();
  // Ignore 1-char queries: too unselective to scan 100k+ rows for.
  const q = rawQ.length >= 2 ? rawQ : '';
  const digitsOnly = /^\d+$/.test(q);
  // Floor so a fractional ?page (e.g. 1.9) can't reach Prisma as a non-integer skip
  // / SQL OFFSET and 500 the listing; Math.floor(NaN)=NaN, NaN||1 → 1 for bad input.
  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);

  // "Hamma sana" resolves to the newest portfolio (snapshots are full per-date dumps).
  const snapshot = date === 'all'
    ? snapshots[0]!
    : await prisma.snapshot.findUnique({ where: { reportDate: new Date(`${date}T00:00:00.000Z`) }, select: { id: true } });
  const linkDate = date === 'all' ? latestDate : date;
  const useFullText = !!q && !digitsOnly && q.length >= 3;

  if (!snapshot) {
    return (
      <div>
        <PageHeader title="Mijozlar" subtitle="Portfeldagi mijozlar (PINFL boʻyicha)" />
        <EmptyState title="Snapshot topilmadi" hint="Boshqa sanani tanlang." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Mijozlar" subtitle="Portfeldagi mijozlar (PINFL boʻyicha) — qidiring va kartasiga kiring" />
      <MijozlarFilters dates={dates} date={date} initialQ={q} />
      {/* The client table (heavy top-debt groupBy) streams in — header + search
          paint instantly, so the operator can start typing immediately. */}
      <Suspense
        key={`${snapshot.id}-${q}-${page}`}
        fallback={<div className="card mt-2 space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}</div>}
      >
        <MijozlarTable snapshotId={snapshot.id} linkDate={linkDate} date={date} q={q} digitsOnly={digitsOnly} useFullText={useFullText} page={page} />
      </Suspense>
    </div>
  );
}
