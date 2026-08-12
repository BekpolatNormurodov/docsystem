import { describe, it, expect } from 'vitest';
import { resolveRegionId, resolveAreaMatch, resolveAreaId, resolveHippoRegionArea } from './hippo-regions';

describe('resolveRegionId — portfolio region name → hippo region id', () => {
  it('maps the common oblast forms and the city-before-region rule', () => {
    expect(resolveRegionId('САМАРКАНДСКАЯ ОБЛАСТЬ')).toBe(3);
    expect(resolveRegionId('ГОРОД ТАШКЕНТ')).toBe(1);
    expect(resolveRegionId('ТАШКЕНТСКАЯ ОБЛАСТЬ')).toBe(2); // region, not the city
    expect(resolveRegionId('КАРАКАЛПАКСТАН')).toBe(13);
    expect(resolveRegionId('ФАРГОНА ВИЛОЯТИ')).toBe(6);
  });
  it('returns 0 for an unknown region', () => {
    expect(resolveRegionId('НOWHERE')).toBe(0);
    expect(resolveRegionId('')).toBe(0);
  });
});

describe('resolveAreaMatch — id + how confident the match is', () => {
  it('reports "none" when the region is 0 or the district is empty', () => {
    expect(resolveAreaMatch(0, 'Кунгирот тумани')).toEqual({ id: 0, confidence: 'none' });
    expect(resolveAreaMatch(13, '')).toEqual({ id: 0, confidence: 'none' });
  });
  it('reports "override" for a manually-mapped district and returns its exact id', () => {
    // AREA_OVERRIDES '13|КУНГИРОТ' → 180 (Кунград тумани).
    expect(resolveAreaMatch(13, 'Кунгирот тумани')).toEqual({ id: 180, confidence: 'override' });
  });
  it('resolveAreaId is exactly resolveAreaMatch(...).id (backward-compatible wrapper)', () => {
    for (const [r, d] of [[13, 'Кунгирот тумани'], [3, 'Ургут тумани'], [0, 'x'], [1, '']] as const) {
      expect(resolveAreaId(r, d)).toBe(resolveAreaMatch(r, d).id);
    }
  });
});

describe('resolveHippoRegionArea — carries the area confidence for review', () => {
  it('resolves region + area together and exposes areaConfidence', () => {
    const r = resolveHippoRegionArea('КАРАКАЛПАКСТАН', 'Кунгирот тумани');
    expect(r.regionId).toBe(13);
    expect(r.areaId).toBe(180);
    expect(r.areaConfidence).toBe('override');
  });
  it('a whole-city input with no resolvable district yields areaId 0 / none (never a fuzzy guess)', () => {
    const r = resolveHippoRegionArea('ГОРОД ТАШКЕНТ', '');
    expect(r.regionId).toBe(1);
    expect(r.areaId).toBe(0);
    expect(r.areaConfidence).toBe('none');
  });
});
