import { describe, it, expect } from 'vitest';
import { mapRowToLoan, computeTotalDebt } from './portfolio';

// exceljs streaming (WorkbookReader) hands back rich-text / formula / hyperlink cells
// as OBJECTS. Plain String() → "[object Object]" and Number() → NaN, which would put
// "[object Object]" as a defendant name or understate a debt to 0 on a court document.
describe('portfolio — streaming-reader object cells are unwrapped', () => {
  const header = ['pinfl', 'client_name', 'branch', 'summ_ost_ze', 'sumproc_eqv', 'summ_ostpr_ze', 'sumnachpr_eqv'];

  it('reads a rich-text name as its joined text, not "[object Object]"', () => {
    const richName = { richText: [{ text: 'ABDULLAYEV ' }, { text: 'XABIBULLO' }] };
    const l = mapRowToLoan(header, ['30101931662970', richName, '12842', 0, 0, 0, 0]);
    expect(l.clientName).toBe('ABDULLAYEV XABIBULLO');
    expect(l.pinfl).toBe('30101931662970');
  });

  it('reads a rich-text PINFL as digits (never "[object Object]")', () => {
    const richPinfl = { richText: [{ text: '30101931' }, { text: '662970' }] };
    const l = mapRowToLoan(header, [richPinfl, 'X', 'Y', 0, 0, 0, 0]);
    expect(l.pinfl).toBe('30101931662970');
  });

  it('reads a formula debt cell by its computed result (not NaN→0)', () => {
    const formulaDebt = { formula: 'A1*2', result: 5_000_000 };
    const l = mapRowToLoan(header, ['p', 'n', 'b', formulaDebt, 0, 0, 0]);
    expect(l.debtPrincipal).toBe(5_000_000);
    expect(l.totalDebt).toBe(5_000_000);
  });

  it('reads a hyperlink cell by its display text', () => {
    const hyperlinkBranch = { text: '12842', hyperlink: 'http://x' };
    const l = mapRowToLoan(header, ['p', 'n', hyperlinkBranch, 0, 0, 0, 0]);
    expect(l.branchCode).toBe('12842');
  });

  it('computeTotalDebt sums formula cells across all four debt columns', () => {
    expect(computeTotalDebt({
      summ_ost_ze: { formula: 'x', result: 100 },
      sumproc_eqv: { formula: 'x', result: 20 },
      summ_ostpr_ze: { richText: [{ text: '3' }] },
      sumnachpr_eqv: 4,
    })).toBe(127);
  });
});
