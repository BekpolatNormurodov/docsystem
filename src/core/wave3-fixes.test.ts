import { describe, it, expect } from 'vitest';
import { formatSumDecimal } from './document';
import { parseLoanFilters, buildLoanWhere } from './loan-filters';
import { computeTotalDebt, mapRowToLoan, parseDateParts } from './portfolio';
import { cleanTail, mapRegion } from './address';

describe('formatSumDecimal — tiyin padding', () => {
  it('zero-pads a single-digit fraction (Prisma.Decimal drops trailing zeros)', () => {
    expect(formatSumDecimal('100.5')).toBe('100,50');   // was "100,5"
    expect(formatSumDecimal('100.05')).toBe('100,05');
    expect(formatSumDecimal('24318882.63')).toBe('24 318 882,63');
  });
  it('omits the decimal for whole amounts', () => {
    expect(formatSumDecimal('1000000')).toBe('1 000 000');
    expect(formatSumDecimal('100.00')).toBe('100');
  });
});

describe('parseLoanFilters — crash guards', () => {
  it('clamps bad page to 1', () => {
    expect(parseLoanFilters({ page: '-1' }).page).toBe(1);
    expect(parseLoanFilters({ page: 'abc' }).page).toBe(1);
    expect(parseLoanFilters({ page: '1.5' }).page).toBe(1);
    expect(parseLoanFilters({ page: '3' }).page).toBe(3);
  });
  it('drops unparseable/negative minDebt', () => {
    expect(parseLoanFilters({ page: '1', minDebt: 'abc' }).minDebt).toBeUndefined();
    expect(parseLoanFilters({ page: '1', minDebt: '-5' }).minDebt).toBeUndefined();
    expect(parseLoanFilters({ page: '1', minDebt: '1000' }).minDebt).toBe(1000);
  });
});

describe('buildLoanWhere — invalid fromDate ignored', () => {
  it('does not emit an Invalid Date into the where clause', () => {
    const w = buildLoanWhere(1, { page: 1, fromDate: 'xyz' });
    expect(w.dateToCr).toBeUndefined();
    const ok = buildLoanWhere(1, { page: 1, fromDate: '2026-01-01' });
    expect(ok.dateToCr).toBeTruthy();
  });
});

describe('portfolio — locale numbers + trimmed pinfl', () => {
  it('parses locale-formatted numeric text without dropping the value', () => {
    expect(computeTotalDebt({ summ_ost_ze: '12 345,67', summ_ostpr_ze: '1 000', sumproc_eqv: 0, sumnachpr_eqv: 0 }))
      .toBeCloseTo(13345.67, 2);
  });
  it('trims a whitespace-padded PINFL so exclusion matching works', () => {
    const loan = mapRowToLoan(['pinfl', 'client_name'], [' 51234567890123 ', 'X']);
    expect(loan.pinfl).toBe('51234567890123');
  });
});

describe('parseDateParts — range validation', () => {
  it('rejects impossible day/month', () => {
    expect(parseDateParts('spisok_32.13.2024.xlsx')).toBeNull();
  });
  it('parses a valid DD.MM.YYYY', () => {
    expect(parseDateParts('portfel_12.05.2026.xlsx')).toEqual({ day: 12, month: 5, year: 2026 });
  });
});

describe('address — SH segment + Qashqadaryo', () => {
  it('keeps a street beginning with SH. but drops a trailing city-repeat', () => {
    expect(cleanTail('Toshkent obl, Bekobod rayon, SH. RUSTAVELI KUCHASI').toLowerCase()).toContain('rustaveli');
    expect(cleanTail('Navoiy obl, Navbahor rayon, NAVOI SH.').toUpperCase()).not.toContain('NAVOI SH');
  });
  it('maps both single- and double-Н Qashqadaryo spellings', () => {
    expect(mapRegion('КАШКАДАРЬИНСКАЯ ОБЛАСТЬ')).toBe('Qashqadaryo viloyati');
    expect(mapRegion('КАШКАДАРЬИННСКАЯ ОБЛАСТЬ')).toBe('Qashqadaryo viloyati');
  });
});
