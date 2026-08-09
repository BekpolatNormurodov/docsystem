import { describe, it, expect } from 'vitest';
import { buildTalabnomaRows, type TalabnomaLoan } from './talabnoma-excel';

const base: TalabnomaLoan = {
  pinfl: '30510913370024', branchCode: '12842', clientName: 'MATYAKUPOV BABUR',
  postAddress: null, postAddressUz: 'Toshkent shahri, Chilonzor tumani', regionName: 'ГОРОД ТАШКЕНТ',
  ldId: '111', dateToCr: new Date('2026-04-13'), summKr: 1_000_000, totalDebt: 1_100_000,
  raw: { distr_name: 'ЧИЛОНЗОР ТУМАНИ' },
};
const docDate = new Date('2026-07-31');

describe('buildTalabnomaRows', () => {
  it('groups a client×firm across contracts and sums the debt', () => {
    const rows = buildTalabnomaRows([
      base,
      { ...base, ldId: '222', summKr: 500_000, totalDebt: 600_000 },
    ], docDate);
    expect(rows).toHaveLength(1);
    expect(rows[0].loan_amount).toBe(1_500_000);
    expect(rows[0].total_debt).toBe(1_700_000);
    expect(rows[0].contract_number).toBe('111-222');
  });

  it('does NOT merge two different identity-less (null PINFL) debtors', () => {
    // regression: `${null}|branch` collapsed distinct debtors into one row.
    const rows = buildTalabnomaRows([
      { ...base, pinfl: null, clientName: 'CLIENT A', ldId: 'A1', summKr: 100, totalDebt: 100 },
      { ...base, pinfl: null, clientName: 'CLIENT B', ldId: 'B1', summKr: 200, totalDebt: 200 },
    ], docDate);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.total_debt)).toEqual([100, 200]);
  });

  it('prefers the cleaned Uzbek address, transliterated to Cyrillic', () => {
    const rows = buildTalabnomaRows([base], docDate);
    expect(rows[0].address).toBe('Тошкент шаҳри, Чилонзор тумани');
  });
});
