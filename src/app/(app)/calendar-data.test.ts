import { describe, it, expect, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { getSnapshotDays } from './calendar-data';

describe('getSnapshotDays', () => {
  let snapshotId: number | null = null;

  afterEach(async () => {
    if (snapshotId !== null) {
      await prisma.snapshot.delete({ where: { id: snapshotId } });
      snapshotId = null;
    }
  });

  it('maps a seeded snapshot to the Calendar DayData shape, keyed by YYYY-MM-DD', async () => {
    const snapshot = await prisma.snapshot.create({
      data: { reportDate: new Date('2026-08-03'), sourceFileName: 'fixture.xlsx', status: 'READY' },
    });
    snapshotId = snapshot.id;

    const days = await getSnapshotDays();

    expect(days['2026-08-03']).toEqual({ total: 1, counts: { READY: 1 } });
  });
});
