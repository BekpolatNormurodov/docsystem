import { describe, it, expect } from 'vitest';
import { STAGE_PROGRESSION, STAGES } from './konveyer';

// The "furthest stage" progression drives which case is a person's PRIMARY one in both
// the JS funnel and the SQL person list. A court ACCEPTANCE must outrank a court RETURN
// (rejection) so a person holding both shows as «Sud qabul qildi», not «Sud qaytardi».
describe('STAGE_PROGRESSION — court outcome ranking', () => {
  it('ranks COURT_ACCEPTED above COURT_RETURNED', () => {
    expect(STAGE_PROGRESSION.indexOf('COURT_ACCEPTED')).toBeGreaterThan(STAGE_PROGRESSION.indexOf('COURT_RETURNED'));
  });

  it('keeps the overall pipeline direction: IMPORTED first, CLOSED last, court before MIB', () => {
    expect(STAGE_PROGRESSION[0]).toBe('IMPORTED');
    expect(STAGE_PROGRESSION[STAGE_PROGRESSION.length - 1]).toBe('CLOSED');
    expect(STAGE_PROGRESSION.indexOf('MIB_SUBMITTED')).toBeGreaterThan(STAGE_PROGRESSION.indexOf('COURT_ACCEPTED'));
    expect(STAGE_PROGRESSION.indexOf('SIGNED_SCANNED')).toBeGreaterThan(STAGE_PROGRESSION.indexOf('ARIZA_GENERATED'));
  });

  it('covers exactly the same stage set as the display STAGES (no missing/extra/dup)', () => {
    const prog = [...STAGE_PROGRESSION].sort();
    const disp = STAGES.map((s) => s.key).sort();
    expect(prog).toEqual(disp);
    expect(new Set(STAGE_PROGRESSION).size).toBe(STAGE_PROGRESSION.length);
  });
});
