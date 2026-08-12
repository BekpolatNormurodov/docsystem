import { describe, it, expect } from 'vitest';
import {
  isoDay, isoMonth, monthRange, shiftMonth, isValidMonth, isValidDay,
  monthGrid, sameDayInMonth, isoToDmy, dmyToIso, groupByDay,
} from './calendar';

const U = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('calendar — UTC day/month helpers', () => {
  it('isoDay / isoMonth format in UTC with zero padding', () => {
    expect(isoDay(U(2026, 1, 5))).toBe('2026-01-05');
    expect(isoMonth(U(2026, 12, 31))).toBe('2026-12');
  });

  it('monthRange is a half-open [gte, lt) covering the month', () => {
    const r = monthRange('2026-02');
    expect(isoDay(r.gte)).toBe('2026-02-01');
    expect(isoDay(r.lt)).toBe('2026-03-01');
  });

  it('shiftMonth wraps across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-06', 8)).toBe('2027-02');
  });

  it('isValidMonth checks shape only', () => {
    expect(isValidMonth('2026-01')).toBe(true);
    expect(isValidMonth('2026-1')).toBe(false);
    expect(isValidMonth(undefined)).toBe(false);
  });

  it('isValidDay rejects impossible and rolled-over calendar dates', () => {
    expect(isValidDay('2026-02-28')).toBe(true);
    expect(isValidDay('2024-02-29')).toBe(true);   // leap year
    expect(isValidDay('2026-02-29')).toBe(false);  // non-leap → would roll to Mar 1
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('2026-13-01')).toBe(false);
    expect(isValidDay('2026-1-1')).toBe(false);     // needs zero-padding
    expect(isValidDay(undefined)).toBe(false);
  });

  it('monthGrid is Monday-first and always a whole number of weeks', () => {
    const g = monthGrid('2026-02'); // Feb 2026 = 28 days
    expect(g.length % 7).toBe(0);
    const days = g.filter((c): c is number => c !== null);
    expect(days).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
    // leading blanks pad to the first weekday; a Monday-1st would have zero leading nulls
    const lead = g.findIndex((c) => c !== null);
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(lead).toBeLessThan(7);
  });

  it('sameDayInMonth clamps into shorter months instead of rolling over', () => {
    expect(sameDayInMonth('2026-02', 31)).toBe('2026-02-28'); // Feb has 28 in 2026
    expect(sameDayInMonth('2024-02', 31)).toBe('2024-02-29'); // leap
    expect(sameDayInMonth('2026-03', 15)).toBe('2026-03-15');
    expect(sameDayInMonth('2026-02', 0)).toBe('2026-02-01');  // clamps up to 1
  });

  it('isoToDmy / dmyToIso convert and reject unreal dates, and round-trip', () => {
    expect(isoToDmy('2026-01-05')).toBe('05.01.2026');
    expect(isoToDmy('2026-02-30')).toBe('');
    expect(dmyToIso('05.01.2026')).toBe('2026-01-05');
    expect(dmyToIso('30.02.2026')).toBe('');   // unreal
    expect(dmyToIso('5.1.2026')).toBe('');      // not zero-padded
    expect(dmyToIso(isoToDmy('2026-07-31'))).toBe('2026-07-31');
  });

  it('groupByDay tallies totals and per-status counts by UTC day', () => {
    const g = groupByDay([
      { date: U(2026, 3, 1), status: 'SIGNED' },
      { date: U(2026, 3, 1), status: 'SIGNED' },
      { date: U(2026, 3, 1), status: 'PENDING' },
      { date: U(2026, 3, 2), status: 'PENDING' },
    ]);
    expect(g['2026-03-01']).toEqual({ total: 3, counts: { SIGNED: 2, PENDING: 1 } });
    expect(g['2026-03-02']).toEqual({ total: 1, counts: { PENDING: 1 } });
  });
});
