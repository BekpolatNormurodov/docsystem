import { describe, it, expect } from 'vitest';
import { arizaZipPath } from './export-paths';

describe('arizaZipPath', () => {
  it('builds the DD.MM.YY / client pinfl / firm / ldId client.docx tree, sanitized', () => {
    expect(arizaZipPath(new Date('2026-07-09'), 'AAA/BBB', '123', 'FIRMA', '2244')).toBe(
      '09.07.26/AAA_BBB 123/FIRMA/2244 AAA_BBB.docx',
    );
  });
});
