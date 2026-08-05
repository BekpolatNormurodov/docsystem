import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import Excel from 'exceljs';
import { parseExclusionPinfls } from './parse-exclusion';

describe('parseExclusionPinfls', () => {
  let fixturePath: string | null = null;

  afterEach(async () => {
    if (fixturePath) {
      await fs.rm(fixturePath, { force: true });
      fixturePath = null;
    }
  });

  it('reads pinfls from the Pnfl sheet and ignores a decoy sheet', async () => {
    fixturePath = path.join(os.tmpdir(), `exclusion-fixture-${Date.now()}.xlsx`);

    const workbook = new Excel.Workbook();

    const decoy = workbook.addWorksheet('Muamolilar');
    decoy.addRow(['ПНФЛ', 'ФИО', 148.01, 124.05, 163.77, '12405%+16377%', 'ТЕЛ', 'ВИЛОЯТ', 'ТУМАН']);
    decoy.addRow(['99999999999999', 'DECOY PERSON', 1, 2, 3, '', '', '', '']);

    const sheet = workbook.addWorksheet('Pnfl');
    sheet.addRow(['ПНФЛ', 'ФИО', 148.01, 124.05, 163.77, '12405%+16377%', 'ТЕЛ', 'ВИЛОЯТ', 'ТУМАН']);
    sheet.addRow(['10000000000001', 'ALPHA ONE', 1, 2, 3, '', '', '', '']);
    sheet.addRow(['10000000000002', 'BETA TWO', 1, 2, 3, '', '', '', '']);
    sheet.addRow(['10000000000003', 'GAMMA THREE', 1, 2, 3, '', '', '', '']);

    await workbook.xlsx.writeFile(fixturePath);

    const result = await parseExclusionPinfls(fixturePath);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(3);
    expect(result.has('10000000000001')).toBe(true);
    expect(result.has('10000000000002')).toBe(true);
    expect(result.has('10000000000003')).toBe(true);
    expect(result.has('99999999999999')).toBe(false);
  });
});
