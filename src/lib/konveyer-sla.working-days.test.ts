import { describe, it, expect } from 'vitest';
import { addWorkingDays, SLA_DEFAULTS } from './konveyer-sla';

// Local-constructed dates so getDay()/setDate() (which addWorkingDays uses) are
// consistent regardless of the runner's timezone. 2026-01-02 is a Friday.
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const FRI = local(2026, 1, 2);
const MON = local(2026, 1, 5);

describe('addWorkingDays — SLA clock skips weekends', () => {
  it('Friday + 1 working day lands on Monday', () => {
    const r = addWorkingDays(FRI, 1);
    expect(r.getDay()).toBe(1);   // Monday
    expect(r.getDate()).toBe(5);
  });

  it('Monday + 5 working days lands on the next Monday (two weekend days skipped)', () => {
    const r = addWorkingDays(MON, 5);
    expect(r.getDay()).toBe(1);
    expect(r.getDate()).toBe(12);
  });

  it('the SIGN=3 default (palata) from a Wednesday clears the weekend to Monday', () => {
    const WED = local(2026, 1, 7);
    const r = addWorkingDays(WED, 3); // Thu, Fri, (skip Sat/Sun), Mon
    expect(r.getDay()).toBe(1);
    expect(r.getDate()).toBe(12);
  });

  it('adding 0 days returns the same calendar day (a fresh copy, no mutation)', () => {
    const r = addWorkingDays(FRI, 0);
    expect(r.getTime()).toBe(FRI.getTime());
    expect(r).not.toBe(FRI);
  });
});

describe('SLA_DEFAULTS — legally meaningful deadlines are pinned', () => {
  it('keeps palata=3 and sud=11 working days (0-day phases have no timer)', () => {
    expect(SLA_DEFAULTS).toMatchObject({ PREP: 0, SIGN: 3, BOJ: 3, COURT: 11, EXEC: 0 });
  });
});
