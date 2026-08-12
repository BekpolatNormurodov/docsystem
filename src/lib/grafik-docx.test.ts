import { describe, it, expect } from 'vitest';
import { annuity, monthsBetween, addMonthsUTC, isSchedulableLoan } from './grafik-docx';

const D = (s: string) => new Date(s + 'T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('annuity schedule (kredit toʻlash grafigi)', () => {
  it('principal column sums EXACTLY to the loan amount and the balance ends at 0', () => {
    const s = annuity(5_000_000, 62, 72, D('2026-03-31'));
    expect(s).toHaveLength(72);
    const sumP = s.reduce((a, r) => a + r.principal, 0);
    expect(sumP).toBe(5_000_000);
    expect(s[s.length - 1].balance).toBe(0);
    // every row: payment == principal + interest, no NaN/negative
    for (const r of s) {
      expect(r.payment).toBe(r.principal + r.interest);
      expect(Number.isFinite(r.payment)).toBe(true);
      expect(r.balance).toBeGreaterThanOrEqual(0);
    }
  });

  it('is "teng summa": the monthly payment is constant across the schedule', () => {
    const s = annuity(7_000_000, 54, 36, D('2026-01-10'));
    const first = s[0].payment;
    // all but the last row (which absorbs the residue) are equal
    for (const r of s.slice(0, -1)) expect(r.payment).toBe(first);
  });

  it('rate=0 → no interest, equal principal, sums to the amount', () => {
    const s = annuity(1_200_000, 0, 12, D('2026-01-01'));
    expect(s.every((r) => r.interest === 0)).toBe(true);
    expect(s.reduce((a, r) => a + r.principal, 0)).toBe(1_200_000);
    expect(s[s.length - 1].balance).toBe(0);
  });
});

describe('monthsBetween', () => {
  it('caps a corrupt far-future maturity at 600 months (no OOM)', () => {
    expect(monthsBetween(D('2026-01-01'), D('2999-01-01'))).toBe(600);
  });
  it('never returns less than 1 (equal/backwards dates)', () => {
    expect(monthsBetween(D('2026-06-01'), D('2026-06-01'))).toBe(1);
    expect(monthsBetween(D('2026-06-01'), D('2026-01-01'))).toBe(1);
  });
  it('computes a normal term', () => {
    expect(monthsBetween(D('2026-01-01'), D('2027-01-01'))).toBe(12);
  });
});

describe('isSchedulableLoan — keeps a grafik off court docs when data is bad', () => {
  const good = { summKr: 5_000_000, dateToCr: D('2024-01-01'), dateClose: D('2025-01-01') };
  it('accepts a positive amount with chronological dates', () => {
    expect(isSchedulableLoan(good)).toBe(true);
  });
  it('rejects a reversed/swapped date pair (maturity before disbursement)', () => {
    expect(isSchedulableLoan({ ...good, dateToCr: D('2024-06-01'), dateClose: D('2023-01-01') })).toBe(false);
  });
  it('rejects equal dates (0-month schedule)', () => {
    expect(isSchedulableLoan({ ...good, dateToCr: D('2024-01-01'), dateClose: D('2024-01-01') })).toBe(false);
  });
  it('rejects a missing date or a non-positive amount', () => {
    expect(isSchedulableLoan({ ...good, dateClose: null })).toBe(false);
    expect(isSchedulableLoan({ ...good, dateToCr: null })).toBe(false);
    expect(isSchedulableLoan({ ...good, summKr: 0 })).toBe(false);
    expect(isSchedulableLoan({ ...good, summKr: '' })).toBe(false);
  });
});

describe('addMonthsUTC — end-of-month clamp', () => {
  it('clamps Jan 31 + 1 to end of February, not March 3', () => {
    expect(iso(addMonthsUTC(D('2026-01-31'), 1))).toBe('2026-02-28');
    expect(iso(addMonthsUTC(D('2024-01-31'), 1))).toBe('2024-02-29'); // leap year
  });
  it('keeps a valid day', () => {
    expect(iso(addMonthsUTC(D('2026-01-15'), 2))).toBe('2026-03-15');
  });
});
