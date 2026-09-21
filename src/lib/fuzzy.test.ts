import { describe, expect, it } from 'vitest';
import { diceRatio, fuzzyNameScore, isDigitQuery, matchesFuzzy, fuzzyPrismaOr, DEFAULT_THRESHOLD } from './fuzzy';

describe('diceRatio', () => {
  it('=1 for identical', () => expect(diceRatio('ismoilov', 'ismoilov')).toBe(1));
  it('=0 for disjoint short', () => expect(diceRatio('a', 'b')).toBe(0));
  it('symmetric', () => expect(diceRatio('karim', 'karem')).toBe(diceRatio('karem', 'karim')));
  it('bir harf yo\'qolgan — chegara ustida', () => expect(diceRatio('ismoilv', 'ismoilov')).toBeGreaterThan(0.7));
});

describe('isDigitQuery', () => {
  it('to\'liq raqam', () => expect(isDigitQuery('52803085830015')).toBe(true));
  it('probellar bilan', () => expect(isDigitQuery('528 030 85830015')).toBe(true));
  it('ism → yo\'q', () => expect(isDigitQuery('ismoilov')).toBe(false));
  it('bo\'sh → yo\'q', () => expect(isDigitQuery('')).toBe(false));
  it('juda qisqa (2 raqam) → yo\'q', () => expect(isDigitQuery('52')).toBe(false));
  it('aralash (ism+raqam) → ism', () => expect(isDigitQuery('ism528')).toBe(false));
});

describe('fuzzyNameScore', () => {
  it('bir harf almashgan — hech qanday farq yo\'q', () => expect(fuzzyNameScore('ISMOILOV KARIM', 'ISMOILOV KARIM')).toBe(1));
  it('bitta yo\'qolgan harf', () => expect(fuzzyNameScore('ISMOILOV', 'ISMOILV')).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD));
  it('bitta so\'z yo\'q', () => expect(fuzzyNameScore('ISMOILOV KARIM ODIL O\'G\'LI', 'ISMOILOV KARIM')).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD));
  it('so\'z tartibi (bir xil tokenlar)', () => expect(fuzzyNameScore('KARIM ISMOILOV', 'ISMOILOV KARIM')).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD));
  it('butunlay boshqa ism', () => expect(fuzzyNameScore('ABDULLAYEV', 'RAHIMOV')).toBeLessThan(DEFAULT_THRESHOLD));
  it('apostroflar sezilmaydi', () => expect(fuzzyNameScore('TO\'LANOV O\'G\'LI', 'TOLANOV OGLI')).toBe(1));
  it('X↔H sezilmaydi (normName folds X→H)', () => expect(fuzzyNameScore('AXMEDOV', 'AHMEDOV')).toBe(1));
});

describe('matchesFuzzy', () => {
  const alice = { name: 'ISMOILOV KARIM ODIL O\'G\'LI', pinfl: '52803085830015' };
  const bob = { name: 'ABDULLAYEV JAMSHID BOTIR O\'G\'LI', pinfl: '30506901234567' };

  it('ism aniq', () => expect(matchesFuzzy(alice, 'ismoilov karim')).toBe(true));
  it('ism qisman yozilgan', () => expect(matchesFuzzy(alice, 'ismoilov')).toBe(true));
  it('ismda bir yo\'qolgan harf', () => expect(matchesFuzzy(alice, 'ismoilv karim')).toBe(true));
  it('apostrof/X↔H parvo qilmaydi', () => expect(matchesFuzzy({ name: 'AXMEDOV RAHIM O\'G\'LI' }, 'ahmedov rahim ogli')).toBe(true));
  it('boshqa ismga o\'tmaydi', () => expect(matchesFuzzy(alice, 'abdullayev')).toBe(false));

  it('pinfl aniq', () => expect(matchesFuzzy(alice, '52803085830015')).toBe(true));
  it('pinfl qismi', () => expect(matchesFuzzy(alice, '528030858')).toBe(true));
  it('pinfl bir raqam xato → topilmaydi', () => expect(matchesFuzzy(alice, '52803085830016')).toBe(false));
  it('pinfl boshqa odam', () => expect(matchesFuzzy(alice, '30506901234567')).toBe(false));

  it('bo\'sh so\'rov = true (filtr yo\'q)', () => expect(matchesFuzzy(alice, '')).toBe(true));
  it('extras — ish raqami substring', () => expect(matchesFuzzy({ ...alice, extras: ['AA02-2026-1234'] }, 'aa02')).toBe(true));
  it('extras — ismga fuzzy tushmaydi (aniq substring emas)', () => expect(matchesFuzzy({ ...bob, extras: ['sud-123'] }, 'ismoilov')).toBe(false));
});

describe('fuzzyPrismaOr', () => {
  it('bo\'sh → undefined', () => expect(fuzzyPrismaOr('', ['clientName'])).toBeUndefined());
  it('raqamli → pinfl contains', () => expect(fuzzyPrismaOr('52803085', ['clientName', 'kod'])).toEqual({ pinfl: { contains: '52803085' } }));
  it('ismli → har token har maydonga OR contains', () => {
    const w = fuzzyPrismaOr('ismoilov karim', ['clientName', 'kod']) as { OR: Array<Record<string, { contains: string }>> };
    expect(w.OR).toHaveLength(4);
    const seen = new Set<string>();
    for (const o of w.OR) { const [k, v] = Object.entries(o)[0]; seen.add(`${k}:${(v as { contains: string }).contains}`); }
    expect(seen.has('clientName:ISMOILOV')).toBe(true);
    expect(seen.has('kod:KARIM')).toBe(true);
  });
  it('juda qisqa (2 harf) — oddiy contains', () => {
    const w = fuzzyPrismaOr('ka', ['clientName']) as { OR: Array<Record<string, { contains: string }>> };
    expect(w.OR).toEqual([{ clientName: { contains: 'ka' } }]);
  });
});
