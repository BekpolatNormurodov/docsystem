import { describe, it, expect } from 'vitest';
import { arizaZipPath, uniqueZipPath } from './export-paths';

describe('arizaZipPath', () => {
  it('builds DD.MM.YY/client pinfl/client firm DD.MM.YYYY.docx, sanitized', () => {
    expect(arizaZipPath(new Date('2026-07-09'), 'AAA/BBB', '123', 'FIRMA')).toBe(
      '09.07.26/AAA_BBB 123/AAA_BBB FIRMA 09.07.2026.docx',
    );
  });
});

describe('uniqueZipPath', () => {
  it('returns the path as-is when unused', () => {
    const used = new Set<string>();
    expect(uniqueZipPath('a/b c.docx', used)).toBe('a/b c.docx');
  });
  it('appends (2), (3)… on collision', () => {
    const used = new Set<string>();
    const p = 'x/NAME FIRMA 09.07.2026.docx';
    expect(uniqueZipPath(p, used)).toBe('x/NAME FIRMA 09.07.2026.docx');
    expect(uniqueZipPath(p, used)).toBe('x/NAME FIRMA 09.07.2026 (2).docx');
    expect(uniqueZipPath(p, used)).toBe('x/NAME FIRMA 09.07.2026 (3).docx');
  });
});
