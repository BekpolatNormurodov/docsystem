import { describe, it, expect } from 'vitest';
import { ofertaFields } from './oferta-pdf';

const D = (s: string) => new Date(s + 'T00:00:00Z');
const loan = { ldId: '16455', summKr: 2_000_000, rate: 54, dateToCr: D('2026-04-13'), dateClose: D('2032-04-05') };
// `code` drives the per-firm oferta реквизит lookup (OFERTA_REQV) — BRIGHT = 12842. Without it the
// reqvizit falls back to `address` ('Toshkent'), which is exactly the wrong template constant the
// per-firm map exists to replace.
const firm = { code: '12842', legalName: '«BRIGHT FUTURE FINANCING MIKROMOLIYA TASHKILOTI» MCHJ', shortName: 'BRIGHT', address: 'Toshkent', stir: '311 976 765', bankAccount: '20216000207212842001', mfo: '01183' };
const digits = (s: string) => s.replace(/\D/g, ''); // strip nbsp groups, comma, «сўм» — keep the number

describe('ofertaFields — per-loan oferta values', () => {
  it('fills client, amount (2-decimal, space-grouped) and rate', () => {
    const f = ofertaFields(loan, firm, 'MATYAKUPOV BABUR MAXSETBAEVICH', '30510913370024', 0);
    expect(f.client_name).toBe('MATYAKUPOV BABUR MAXSETBAEVICH');
    expect(f.client_pinfl).toBe('30510913370024');
    expect(digits(f.loan_amount)).toBe('200000000'); // «2 000 000,00»
    expect(f.rate).toBe('54');
  });

  it('derives the REAL term from date_actu_close (12 mo), not the credit-line expiry (72 mo)', () => {
    // 2026-04-13 = Excel serial 46125; +365 days = 46490 = 2027-04-13 → 12 months.
    const withActu = { ...loan, raw: { date_actu_close: 46490 } };
    expect(ofertaFields(withActu, firm, 'X', 'p', 0).loan_term).toBe('12');
    // Without the raw actual-close, it falls back to dateClose (2032) → ~72 months.
    expect(ofertaFields(loan, firm, 'X', 'p', 0).loan_term).toBe('72');
  });

  it('computes «тўлиқ қиймати» as the annuity total (> principal, since there is interest)', () => {
    const f = ofertaFields({ ...loan, raw: { date_actu_close: 46490 } }, firm, 'X', 'p', 0);
    expect(Number(digits(f.full_value))).toBeGreaterThan(2_000_000_00); // > 2 000 000,00
  });

  it('insurance = 4% of sumguarr (portfolio), or 19% of principal when sumguarr is absent', () => {
    // No sumguarr → 19% of principal: 2 000 000 → 380 000 (matches the firm reference).
    const noGuar = ofertaFields(loan, firm, 'X', 'p', 0);
    expect(digits(noGuar.insurance)).toBe('38000000'); // «380 000,00»
    expect(noGuar.insurance_cell).toContain('миқдоридаги микроқарзни тўламаслик');

    // 4.75× guarantee (sumguarr 9 500 000) → 4% = 380 000 (== 19% of principal here).
    const g475 = ofertaFields({ ...loan, raw: { sumguarr: 9_500_000 } }, firm, 'X', 'p', 0);
    expect(digits(g475.insurance)).toBe('38000000');
    // 3.5× guarantee (sumguarr 7 000 000) → 4% = 280 000 (< 19% of principal).
    const g35 = ofertaFields({ ...loan, raw: { sumguarr: 7_000_000 } }, firm, 'X', 'p', 0);
    expect(digits(g35.insurance)).toBe('28000000'); // «280 000,00»

    // Explicit pct overrides: 10% of principal → 200 000.
    const ten = ofertaFields(loan, firm, 'X', 'p', 10);
    expect(digits(ten.insurance)).toBe('20000000');
  });

  it('firm name/title, the fixed reference reqvizit, and the masked ewallet account', () => {
    const f = ofertaFields({ ...loan, raw: { account: '14801000160143529001' } }, firm, 'X', 'p', 0);
    expect(f.firm_name).toContain('BRIGHT FUTURE FINANCING');
    expect(f.firm_name.startsWith('«')).toBe(false);
    expect(f.firm_title).toContain('BRIGHT FUTURE FINANCING');
    // Реквизит is the reference legal address + contact (shared across the affiliated MMTs).
    expect(f.firm_reqvizit).toContain('Гуручарик МФЙ');
    expect(f.firm_reqvizit).toContain('Контакт: 71-231-97-01');
    // Электрон ҳамён is a FIXED reference constant — the real ofertas print «(22616…200)» for every
    // client (a validated template value, NOT the portfolio account), so it's the same regardless of
    // whether the row carries an account.
    expect(f.ewallet_acc).toBe(' (22616…200)');
    expect(ofertaFields(loan, firm, 'X', 'p', 0).ewallet_acc).toBe(' (22616…200)');
  });

  it('falls back to a 12-month term when a date is missing (no crash)', () => {
    const f = ofertaFields({ ...loan, dateClose: null }, firm, 'X', 'p', 0);
    expect(f.loan_term).toBe('12');
  });
});
