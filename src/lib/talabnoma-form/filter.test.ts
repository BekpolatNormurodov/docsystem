import { describe, it, expect } from 'vitest';
import { evaluate, passesTotal, isReadyFirm, canonCode, DEFAULT_THRESHOLD } from './filter';
import type { CandidatesFile, CandidatePerson } from './types';

const person = (p: Partial<CandidatePerson> & { pinfl: string }): CandidatePerson => ({
  fio: 'X', totalOverdue: 0, address: null, phone: null, region: null, district: null,
  firmsText: null, perFirm: {}, loans: [], ...p,
});

// Лист3-style codes: 12842 Bright (ready), 06292 Urban (ready), 55890 Community (ready), 14276 Fundflow (not).
const file: CandidatesFile = {
  docDate: new Date('2026-08-20').toISOString(),
  firmNameByCode: { '12842': 'Bright', '6292': 'Urban', '55890': 'Community', '14276': 'Fundflow' },
  people: [
    person({ pinfl: 'A', totalOverdue: -2_500_000, perFirm: { '12842': -1_500_000, '55890': -1_000_000 } }), // 2 ready firms
    person({ pinfl: 'B', totalOverdue: -1_900_000, perFirm: { '12842': -1_900_000 } }), // below threshold
    person({ pinfl: 'C', totalOverdue: -3_000_000, perFirm: { '14276': -3_000_000 } }), // only non-ready firm
    person({ pinfl: 'D', totalOverdue: -2_000_000, perFirm: { '12842': -50_000, '14276': -1_950_000 } }), // ready firm tiny
  ],
};

describe('canonCode', () => {
  it('drops leading zeros so 06292 === 6292', () => {
    expect(canonCode('06292')).toBe('6292');
    expect(canonCode(6292)).toBe('6292');
  });
});

describe('readiness', () => {
  it('Bright/Urban/Community are ready, Fundflow is not', () => {
    expect(isReadyFirm('12842')).toBe(true);
    expect(isReadyFirm('06292')).toBe(true);
    expect(isReadyFirm('55890')).toBe(true);
    expect(isReadyFirm('14276')).toBe(false);
  });
});

describe('passesTotal', () => {
  it('uses absolute total overdue against the threshold', () => {
    expect(passesTotal(file.people[0]!, { thresholdTotal: DEFAULT_THRESHOLD, perFirmMin: 0 })).toBe(true);
    expect(passesTotal(file.people[1]!, { thresholdTotal: DEFAULT_THRESHOLD, perFirmMin: 0 })).toBe(false);
  });
});

describe('evaluate — filter A (total 2mln)', () => {
  const r = evaluate(file, { thresholdTotal: DEFAULT_THRESHOLD, perFirmMin: 0 });
  it('qualifies A, C, D but not B', () => {
    expect(r.qualifiedPeople).toBe(3);
  });
  it('C (only Fundflow) counts as unready; A and D have a ready firm', () => {
    expect(r.readyPersonCount).toBe(2); // A, D
    expect(r.unreadyPersonCount).toBe(1); // C
  });
  it('buckets Bright with A+D, Community with A, Fundflow with C+D', () => {
    const by = Object.fromEntries(r.firms.map((f) => [f.code, f]));
    expect(by['12842']!.personCount).toBe(2);
    expect(by['12842']!.ready).toBe(true);
    expect(by['55890']!.personCount).toBe(1);
    expect(by['14276']!.ready).toBe(false);
    expect(by['14276']!.personCount).toBe(2); // C and D
  });
});

describe('evaluate — filter B (per-firm minimum)', () => {
  it('a per-firm floor of 100k drops D from Bright (only 50k there)', () => {
    const r = evaluate(file, { thresholdTotal: DEFAULT_THRESHOLD, perFirmMin: 100_000 });
    const by = Object.fromEntries(r.firms.map((f) => [f.code, f]));
    expect(by['12842']!.personCount).toBe(1); // only A now
    // D still qualifies overall (Fundflow 1.95m ≥ 100k) but is unready → unreadyPersonCount includes it
    expect(r.unreadyPersonCount).toBe(2); // C and D
  });
});
