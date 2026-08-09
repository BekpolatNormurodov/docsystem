import { describe, it, expect } from 'vitest';
import { mapRegion, mapDistrict, cleanTail, normalizeAddress } from './address';

describe('mapRegion', () => {
  it('maps the 14 regions, handling Latin-H/I look-alikes in the Cyrillic', () => {
    expect(mapRegion('HАМАHГАHСКАЯ ОБЛАСТЬ')).toBe('Namangan viloyati'); // Latin H
    expect(mapRegion('НАМАНГАНСКАЯ ОБЛАСТЬ')).toBe('Namangan viloyati'); // real Cyrillic Н
    expect(mapRegion('ГОРОД ТАШКЕHТ')).toBe('Toshkent shahri');
    expect(mapRegion('РЕСПУБЛИКА КАРАКАЛПАКСТАH')).toBe('Qoraqalpogʻiston Respublikasi');
    expect(mapRegion('ФЕРГАHСКАЯ ОБЛАСТЬ')).toBe('Fargʻona viloyati');
  });
  it('returns null for unknown', () => {
    expect(mapRegion('SOMEWHERE')).toBeNull();
    expect(mapRegion(null)).toBeNull();
  });
});

describe('mapDistrict', () => {
  it('maps district with correct Uzbek Latin spelling (not mechanical translit)', () => {
    expect(mapDistrict('ЧУСТ ТУМАНИ')).toBe('Chust tumani');
    expect(mapDistrict('КУРГОНТЕПА ТУМАНИ')).toBe('Qoʻrgʻontepa tumani');
    expect(mapDistrict('ФАРГОНА ШАХРИ')).toBe('Fargʻona shahri');
    expect(mapDistrict('ЗАРАФШОН ШАХРИ')).toBe('Zarafshon shahri');
    expect(mapDistrict('ШАРОФ РАШИДОВ ТУМАНИ')).toBe('Sharof Rashidov tumani');
  });
  it('returns null for unknown', () => {
    expect(mapDistrict('НЕТ ТУМАНИ')).toBeNull();
  });
});

describe('cleanTail', () => {
  it('drops region/rayon prefix and cleans mahalla/street/house tokens', () => {
    expect(cleanTail('UZBEKISTAN, NAMANGANSKAYA OBLAST, CHUSTSKIY RAYON, SHOYON MSG, UL. SHOYON'))
      .toBe('Shoyon MFY, Shoyon'); // "UL. SHOYON" has no KUCHASI marker → бare name, no "koʻchasi" appended
    expect(cleanTail('RESPUBLIKA UZBEKISTAN, BUXARSKAYA OBLAST, SHAFIRKANSKIY RAYON, UL. ISKOGARE MFY, OYNAKUL KUCHASI, D. 28B, KV.'))
      .toBe('Iskogare MFY, Oynakul koʻchasi, 28B-uy'); // explicit KUCHASI → "koʻchasi"
    expect(cleanTail('RESPUBLIKA UZBEKISTAN, BUXARSKAYA OBLAST, JONDORSKIY RAYON, UL. OYTUGDI MSG, D. DOM, KV. 105'))
      .toBe('Oytugdi MFY, 105-xonadon');
  });
  it('drops the duplicated GOROD chunk (city already in district)', () => {
    expect(cleanTail('RESPUBLIKA UZBEKISTAN, TASHKENTSKAYA OBLAST, GOROD ANGREN, UL. MUSTAKILLIK MFY, D. 2, KV. 16'))
      .toBe('Mustakillik MFY, 2-uy, 16-xonadon');
  });
  it('drops Cyrillic / corrupted tails whole', () => {
    expect(cleanTail('Республика Узбекистан, Ташкентская Область, Ахангаранский район, ул. ИЛГОР ?ИШЛО?И')).toBe('');
  });
  it('handles no-number house markers and noise', () => {
    expect(cleanTail('RESPUBLIKA UZBEKISTAN, DJIZZAKSKAYA OBLAST, SHARAF RASHIDOVSKIY RAYON, UL. MULKANLIK MFY, LOYIXADAGI KUCHA, D. RS, KV.'))
      .toBe('Mulkanlik MFY, Loyixadagi koʻchasi');
  });
  it('keeps locality-type abbreviations and treats MAVZE as massiv (not mahalla)', () => {
    expect(cleanTail('RESPUBLIKA UZBEKISTAN, GOROD TASHKENT, YUNUSABADSKIY RAYON, UL. KUSHCHINOR MFY, 5 MAVZE, D. 8, KV. 15'))
      .toBe('Kushchinor MFY, 5 mavze, 8-uy, 15-xonadon');
  });
  it('handles a tail with no region/rayon prefix', () => {
    expect(cleanTail('XONOBOD MFY, KURUVCHI DAXASI, UY:4 XONADON:66'))
      .toBe('Xonobod MFY, Kuruvchi dahasi, 4-uy 66-xonadon');
  });
  it('returns empty for empty input', () => {
    expect(cleanTail('')).toBe('');
    expect(cleanTail(null)).toBe('');
  });
});

describe('normalizeAddress', () => {
  it('composes region + district + tail', () => {
    expect(normalizeAddress('HАМАHГАHСКАЯ ОБЛАСТЬ', 'ЧУСТ ТУМАНИ', 'UZBEKISTAN, NAMANGANSKAYA OBLAST, CHUSTSKIY RAYON, SHOYON MSG, UL. SHOYON'))
      .toBe('Namangan viloyati, Chust tumani, Shoyon MFY, Shoyon');
  });
  it('still gives region + district when the tail is unusable', () => {
    expect(normalizeAddress('ТАШКЕHТСКАЯ ОБЛАСТЬ', 'ОХАНГАРОН ТУМАНИ', 'Республика Узбекистан, ул. ?ИШЛО?И'))
      .toBe('Toshkent viloyati, Ohangaron tumani');
  });
});
