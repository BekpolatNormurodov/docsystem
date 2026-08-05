import { describe, it, expect } from 'vitest';
import { computeTotalDebt, mapRowToLoan, parseDateParts } from './portfolio';

describe('computeTotalDebt', () => {
  it('sums the four debt columns', () => {
    expect(computeTotalDebt({
      summ_ost_ze: 100, sumproc_eqv: 20, summ_ostpr_ze: 3, sumnachpr_eqv: 4, ost_17: 999,
    })).toBe(127); // ost_17 excluded
  });
  it('treats blanks/nulls as 0', () => {
    expect(computeTotalDebt({ summ_ost_ze: 100, sumproc_eqv: '', summ_ostpr_ze: null })).toBe(100);
  });
});

describe('mapRowToLoan', () => {
  const header = ['pinfl','client_name','branch','ld_id','summ_ost_ze','sumproc_eqv','summ_ostpr_ze','sumnachpr_eqv','post_address'];
  const values = ['123','AAA BBB','12842','2244',100,20,3,4,'Some address'];
  it('maps typed fields and total', () => {
    const l = mapRowToLoan(header, values);
    expect(l.pinfl).toBe('123');
    expect(l.clientName).toBe('AAA BBB');
    expect(l.branchCode).toBe('12842');
    expect(l.ldId).toBe('2244');
    expect(l.debtPrincipal).toBe(100);
    expect(l.totalDebt).toBe(127);
    expect(l.postAddress).toBe('Some address');
  });
  it('keeps the full row in raw', () => {
    const l = mapRowToLoan(header, values);
    expect(l.raw.post_address).toBe('Some address');
    expect(Object.keys(l.raw)).toHaveLength(header.length);
  });
  it('fills missing trailing cells with null (survives JSON, never undefined)', () => {
    const l = mapRowToLoan(header, ['123', 'AAA BBB']); // short values array, rest missing
    expect(Object.keys(l.raw)).toHaveLength(header.length);
    expect(l.raw.post_address).toBeNull();
    expect(Object.values(l.raw).every((v) => v !== undefined)).toBe(true);
    // JSON round-trip keeps every column
    expect(Object.keys(JSON.parse(JSON.stringify(l.raw)))).toHaveLength(header.length);
  });
});

describe('parseDateParts', () => {
  it('parses DD.MM.YY', () => {
    expect(parseDateParts('портфель 09.07.26 (2).xlsx')).toEqual({ day: 9, month: 7, year: 2026 });
  });
  it('parses bare DD.MM with no year', () => {
    expect(parseDateParts('портфель 09.07 (2).xlsx')).toEqual({ day: 9, month: 7, year: null });
  });
  it('returns null when no date', () => {
    expect(parseDateParts('portfel.xlsx')).toBeNull();
  });
});
