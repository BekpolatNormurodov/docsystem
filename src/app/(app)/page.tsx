import Link from 'next/link';
import { PageHeader, EmptyState, Calendar } from '@/ui';
import { isoDay, isValidMonth, shiftMonth } from '@/core/calendar';
import { getSnapshotDays } from './calendar-data';

export const dynamic = 'force-dynamic';

const LEGEND = [
  { key: 'READY', label: 'Tayyor', dot: 'bg-accent-500' },
  { key: 'IMPORTING', label: 'Yuklanmoqda', dot: 'bg-amber-500' },
  { key: 'FAILED', label: 'Xatolik', dot: 'bg-rose-500' },
];

export default async function Dashboard({
  searchParams,
}: {
  searchParams: { m?: string };
}) {
  const days = await getSnapshotDays();

  if (Object.keys(days).length === 0) {
    return (
      <div>
        <PageHeader title="Kalendar" />
        <EmptyState
          title="Hali portfel yuklanmagan"
          hint={
            <Link href="/import" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              Import boʻlimidan yuklang
            </Link>
          }
        />
      </div>
    );
  }

  const todayIso = isoDay(new Date());
  const todayMonth = todayIso.slice(0, 7);
  const month = isValidMonth(searchParams.m) ? searchParams.m : todayMonth;

  return (
    <div>
      <PageHeader title="Kalendar" />
      <Calendar
        month={month}
        days={days}
        todayIso={todayIso}
        hrefForDay={(iso) => (days[iso] ? `/s/${iso}` : `/?m=${month}`)}
        prevHref={`/?m=${shiftMonth(month, -1)}`}
        nextHref={`/?m=${shiftMonth(month, 1)}`}
        todayHref={`/?m=${todayMonth}`}
        legend={LEGEND}
      />
    </div>
  );
}
