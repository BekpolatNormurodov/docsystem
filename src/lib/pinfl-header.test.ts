import { describe, it, expect } from 'vitest';
import { isPinflHeader, pinflColumnIndex, canonHeader } from './pinfl-header';

describe('isPinflHeader — ideal PINFL column detection', () => {
  it('matches Latin spellings, any case, with/without I', () => {
    for (const h of ['PINFL', 'PNFL', 'pinfl', 'pnfl', 'Pinfl', 'PnFl']) {
      expect(isPinflHeader(h)).toBe(true);
    }
  });

  it('matches Cyrillic spellings, any case', () => {
    for (const h of ['ПИНФЛ', 'ПНФЛ', 'пинфл', 'пнфл']) {
      expect(isPinflHeader(h)).toBe(true);
    }
  });

  it('matches decorated / punctuated headers', () => {
    for (const h of ['№ ПНФЛ', 'PINFL (ЖШШИР)', 'P.I.N.F.L', '  pnfl  ', '№PINFL']) {
      expect(isPinflHeader(h)).toBe(true);
    }
  });

  it('rejects unrelated headers', () => {
    for (const h of ['FIO', 'client_name', 'summa', 'branch', '', null, undefined, 123]) {
      expect(isPinflHeader(h as unknown)).toBe(false);
    }
  });

  it('folds Cyrillic to the same canonical token as Latin', () => {
    expect(canonHeader('ПНФЛ')).toBe('PNFL');
    expect(canonHeader('ПИНФЛ')).toBe('PINFL');
  });

  it('finds the PINFL column past leading columns', () => {
    expect(pinflColumnIndex(['№', 'F.I.O', 'PNFL', 'summa'])).toBe(2);
    expect(pinflColumnIndex(['ПНФЛ'])).toBe(0);
    expect(pinflColumnIndex(['a', 'b', 'c'])).toBe(-1);
  });
});
