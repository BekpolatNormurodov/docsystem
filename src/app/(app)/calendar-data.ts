import { prisma } from '@/lib/db';
import { isoDay } from '@/core/calendar';
import type { DayData } from '@/ui';

/**
 * One snapshot per calendar day (Snapshot.reportDate is unique), so each day's cell just carries
 * that snapshot's status as its single count — reusing the shared Calendar's {total, counts} shape.
 */
export async function getSnapshotDays(): Promise<Record<string, DayData>> {
  const snapshots = await prisma.snapshot.findMany({
    select: { reportDate: true, status: true },
  });

  const days: Record<string, DayData> = {};
  for (const s of snapshots) {
    days[isoDay(s.reportDate)] = { total: 1, counts: { [s.status]: 1 } };
  }
  return days;
}
