import { describe, it, expect, vi, beforeEach } from 'vitest';

type Q = { startedAt: Date | null; createdAt: Date; case: { pinfl: string; kod: string; snapshotId: number } };
const queue: Q[] = [];
vi.mock('./db', () => ({
  prisma: {
    courtQueueItem: {
      // DONE navbat: where.case.snapshotId — son (shu snapshot) yoki { not } (boshqalari, pinfl IN bilan).
      findMany: vi.fn(async ({ where }: { where: { case: { snapshotId: number | { not: number }; pinfl?: { in: string[] } } } }) => {
        const s = where.case.snapshotId;
        if (typeof s === 'number') return queue.filter((q) => q.case.snapshotId === s);
        const pins = new Set(where.case.pinfl && 'in' in where.case.pinfl ? where.case.pinfl.in : []);
        return queue.filter((q) => q.case.snapshotId !== s.not && pins.has(q.case.pinfl));
      }),
    },
  },
}));

import { snapshotCourtScope, uniqueClaims } from './court-scope';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const send = (snapshotId: number, pinfl: string, at: string, kod = '12842'): Q =>
  ({ startedAt: d(at), createdAt: d(at), case: { pinfl, kod, snapshotId } });
const row = (pinfl: string, registryDt: string | null, createdAt = '2026-09-29', branchCode = '12842') =>
  ({ branchCode, pinfl, registryDt: registryDt ? d(registryDt) : null, createdAt: d(createdAt) });

describe('snapshotCourtScope', () => {
  beforeEach(() => { queue.length = 0; });

  it('no snapshot → no filter', async () => {
    expect(await snapshotCourtScope(undefined)).toBeNull();
  });

  it('a snapshot with nothing sent to court owns no ADOLAT row', async () => {
    queue.push(send(5, 'A', '2026-09-10'));
    const s6 = (await snapshotCourtScope(6))!;
    expect(s6.pinfls).toEqual([]);
    expect(s6.has(row('A', '2026-09-12'))).toBe(false);
  });

  it('matches firm code without leading zeros and never another firm', async () => {
    queue.push(send(5, 'A', '2026-09-10', '6292'));
    const s5 = (await snapshotCourtScope(5))!;
    expect(s5.has(row('A', '2026-09-12', '2026-09-29', '06292'))).toBe(true);
    expect(s5.has(row('A', '2026-09-12', '2026-09-29', '12842'))).toBe(false);
  });

  it('a client re-sued from a newer snapshot: each ADOLAT case lands in exactly one snapshot', async () => {
    queue.push(send(5, 'A', '2026-09-10'), send(6, 'A', '2026-10-05'));
    const [s5, s6] = [(await snapshotCourtScope(5))!, (await snapshotCourtScope(6))!];
    const oldCase = row('A', '2026-09-12');                        // registered after the 25.08 send
    const oldReturned = row('A', null, '2026-09-30');              // returned unregistered, first seen before the re-send
    const newCase = row('A', null, '2026-10-06');                  // the 29.09 re-send, not registered yet
    const newRegistered = row('A', '2026-10-07', '2026-10-07');
    const before = row('A', '2026-08-01');                         // older than every send → the first one
    for (const r of [oldCase, oldReturned, before]) { expect(s5.has(r)).toBe(true); expect(s6.has(r)).toBe(false); }
    for (const r of [newCase, newRegistered]) { expect(s6.has(r)).toBe(true); expect(s5.has(r)).toBe(false); }
  });
});

describe('uniqueClaims', () => {
  it('keeps one row per claimId (case_id + case_number twins) and every claim-less row', () => {
    const rows = [{ claimId: 'x', n: 1 }, { claimId: 'x', n: 2 }, { claimId: 'y', n: 3 }, { claimId: null, n: 4 }, { claimId: null, n: 5 }];
    expect(uniqueClaims(rows).map((r) => r.n)).toEqual([1, 3, 4, 5]);
  });
});
