import { describe, it, expect } from 'vitest';
import { nextStage } from './konveyer';

describe('nextStage — pipeline transitions', () => {
  it('advances an accepted case to execution, NOT to the reject bucket', () => {
    // regression: display order put COURT_RETURNED right after COURT_ACCEPTED,
    // so the default advance silently turned accepted cases into rejects.
    expect(nextStage('COURT_ACCEPTED')).toBe('MIB_SUBMITTED');
  });

  it('has no automatic forward step for a returned/rejected case', () => {
    expect(nextStage('COURT_RETURNED')).toBeNull();
  });

  it('keeps the normal forward chain for non-branch stages', () => {
    expect(nextStage('IMPORTED')).not.toBeNull();
    expect(nextStage('COURT_SUBMITTED')).toBe('COURT_ACCEPTED');
  });

  it('returns null at the end of the pipeline', () => {
    expect(nextStage('CLOSED')).toBeNull();
  });
});
