import { describe, it, expect } from 'vitest';
import { numberToUzWords } from './uz-number-words';

// The talabnoma "…soʻzda" columns are legal text — a wrong amount-in-words on a
// court document is a real defect, so pin the documented sample conversions.
describe('numberToUzWords — Uzbek Cyrillic amount in words', () => {
  it('matches the BRIGHT sample conversions verified in the source header', () => {
    expect(numberToUzWords(6_000_000)).toBe('олти миллион');
    expect(numberToUzWords(115_709)).toBe('бир юз ўн беш минг етти юз тўққиз');
    expect(numberToUzWords(52_300_000)).toBe('эллик икки миллион уч юз минг');
  });

  it('emits the corrected spelling "тўқсон" for 90 (source Excel had the "тўксон" typo)', () => {
    expect(numberToUzWords(90)).toBe('тўқсон');
    expect(numberToUzWords(99)).toBe('тўқсон тўққиз');
  });

  it('handles zero and the exact scale boundaries', () => {
    expect(numberToUzWords(0)).toBe('ноль');
    expect(numberToUzWords(1_000)).toBe('бир минг');
    expect(numberToUzWords(1_000_000)).toBe('бир миллион');
    expect(numberToUzWords(1_000_000_000)).toBe('бир миллиард');
  });

  it('floors fractions and takes the absolute value (money is whole soʻm)', () => {
    expect(numberToUzWords(1_234.99)).toBe('бир минг икки юз ўттиз тўрт');
    expect(numberToUzWords(-500)).toBe('беш юз');
  });

  it('accepts a numeric string and rejects non-numeric input with an empty string', () => {
    expect(numberToUzWords('1000000')).toBe('бир миллион');
    expect(numberToUzWords('abc')).toBe('');
    expect(numberToUzWords(NaN)).toBe('');
  });

  it('does not leak double spaces when a middle group is zero', () => {
    // 52_300_000 has a zero ones-group; the source collapses whitespace.
    const w = numberToUzWords(52_300_000);
    expect(w).not.toMatch(/\s{2,}/);
    expect(w.trim()).toBe(w);
  });
});
