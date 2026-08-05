import { describe, it, expect } from 'vitest';
import { parseLoanFilters, buildLoanWhere, loanPageHref } from './loan-filters';

it('parses and defaults page', () => {
  expect(parseLoanFilters({ q: 'ali', branch: '12842', minDebt: '1000000' }))
    .toEqual({ q: 'ali', branch: '12842', minDebt: 1000000, fromDate: undefined, page: 1 });
});

it('builds where with q across pinfl/name/ldId, branch, minDebt, fromDate', () => {
  const w = buildLoanWhere(5, { q: 'ali', branch: '12842', minDebt: 1000000, fromDate: '2026-01-01', page: 1 });
  expect(w.snapshotId).toBe(5);
  expect(w.branchCode).toBe('12842');
  expect(w.totalDebt).toEqual({ gte: 1000000 });
  expect(w.dateToCr).toEqual({ gte: new Date('2026-01-01') });
  expect(Array.isArray(w.OR)).toBe(true); // pinfl/clientName/ldId contains
});

it('empty filters → only snapshotId', () => {
  expect(buildLoanWhere(5, { page: 1 })).toEqual({ snapshotId: 5 });
});

describe('loanPageHref', () => {
  it('builds a querystring merging base filters with a patch', () => {
    const href = loanPageHref('/loans', { q: 'ali', page: 2 }, { page: 3 });
    expect(href).toContain('/loans?');
    expect(href).toContain('q=ali');
    expect(href).toContain('page=3');
    expect(href).not.toContain('page=2');
  });

  it('omits empty/undefined filter values', () => {
    const href = loanPageHref('/loans', { page: 1 }, {});
    expect(href).toBe('/loans?page=1');
  });
});
