import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState, Skeleton } from '@/ui';
import { getT } from '@/lib/i18n/server';
import { MijozlarFilters } from './MijozlarFilters';
import { MijozlarTable } from './MijozlarTable';
import { ClientStatusSearch } from '../_components/ClientStatusSearch';
import { PHASES } from '@/lib/konveyer';

export const dynamic = 'force-dynamic';

export default async function MijozlarPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  await requireUser();
  const t = getT();

  const snapshots = await prisma.snapshot.findMany({
    where: { status: 'READY' },
    orderBy: { reportDate: 'desc' },
    select: { id: true, reportDate: true },
  });

  if (snapshots.length === 0) {
    return (
      <div>
        <PageHeader title={t('Mijozlar')} subtitle={t('Portfeldagi mijozlar (PINFL boʻyicha)')} />
        <EmptyState title={t('Hali portfel yuklanmagan')} hint={t('Hujjatlar boʻlimidan portfel faylini yuklang.')} />
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
  // Bosqich (step) filtri — pipeline fazasi. Faqat mavjud PHASES kalitlari qabul qilinadi.
  const step = PHASES.some((p) => p.key === searchParams.step) ? (searchParams.step as string) : '';
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
        <PageHeader title={t('Mijozlar')} subtitle={t('Portfeldagi mijozlar (PINFL boʻyicha)')} />
        <EmptyState title={t('Snapshot topilmadi')} hint={t('Boshqa sanani tanlang.')} />
      </div>
    );
  }

  // «Holat — Excel»: ekrandagi filtr (snapshot + bosqich + qidiruv) bilan bir xil scope.
  const statusExcelHref = `/mijozlar/status-excel?s=${snapshot.id}${step ? `&step=${step}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <div>
      <PageHeader
        title={t('Mijozlar')}
        subtitle={t('Portfeldagi mijozlar (PINFL boʻyicha) — qidiring va kartasiga kiring')}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ClientStatusSearch linkDate={latestDate} />
            <a className="btn-ghost shrink-0" href={statusExcelHref} title={t('Mijozlar holati (firma · bosqich) — Excel')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              {t('Holat — Excel')}
            </a>
          </div>
        }
      />
      <MijozlarFilters dates={dates} date={date} initialQ={q} step={step} />
      {/* The client table (heavy top-debt groupBy) streams in — header + search
          paint instantly, so the operator can start typing immediately. */}
      <Suspense
        key={`${snapshot.id}-${q}-${page}-${step}`}
        fallback={<div className="card mt-2 space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}</div>}
      >
        <MijozlarTable snapshotId={snapshot.id} linkDate={linkDate} date={date} q={q} digitsOnly={digitsOnly} useFullText={useFullText} page={page} step={step} />
      </Suspense>
    </div>
  );
}
