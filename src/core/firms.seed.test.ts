import { describe, it, expect } from 'vitest';
import { FIRMS_SEED } from './firms.seed';

describe('firm seed', () => {
  it('has 9 firms with unique codes', () => {
    expect(FIRMS_SEED).toHaveLength(9);
    expect(new Set(FIRMS_SEED.map((f) => f.code)).size).toBe(9);
  });

  it('has Bright Future full rekvizit', () => {
    const bf = FIRMS_SEED.find((f) => f.code === '12842')!;
    expect(bf.bankAccount).toBe('20216000207212842001');
    expect(bf.stir).toBe('311 976 765');
  });
});
