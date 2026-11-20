import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Excel from 'exceljs';
import { describe, expect, it } from 'vitest';
import { headerSample, normalizePortfolioHeader } from './portfolio-header';
import { streamXlsxRowsViaUnzipper } from './xlsx-stream';

describe('normalizePortfolioHeader', () => {
  it('keeps an exact lowercase header as is', () => {
    expect(normalizePortfolioHeader(['pinfl', 'client_name'])).toEqual(['pinfl', 'client_name']);
  });
  it('accepts upper case and stray spaces', () => {
    expect(normalizePortfolioHeader([' PINFL ', 'Client_Name'])).toEqual(['pinfl', 'client_name']);
  });
  it('accepts a Cyrillic / decorated PINFL column', () => {
    expect(normalizePortfolioHeader(['№', 'ПИНФЛ'])).toEqual(['№', 'pinfl']);
    expect(normalizePortfolioHeader(['П.Н.Ф.Л', 'branch'])).toEqual(['pinfl', 'branch']);
  });
  it('rejects rows without a PINFL column, incl. look-alikes', () => {
    expect(normalizePortfolioHeader(['F.I.O', 'Manzil'])).toBeNull();
    expect(normalizePortfolioHeader(['pinfl_kafil', 'branch'])).toBeNull();
    expect(normalizePortfolioHeader([null, undefined, ''])).toBeNull();
  });
  it('samples non-empty cells for the error text', () => {
    expect(headerSample([null, ' F.I.O ', '', 'Manzil'])).toEqual(['F.I.O', 'Manzil']);
  });
});

describe('streamXlsxRowsViaUnzipper header scan', () => {
  it('finds a header that is not on the first row', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tf-header-'));
    const file = path.join(dir, 'p.xlsx');
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Portfel 20.11.2026']);
    ws.addRow([]);
    ws.addRow(['PINFL', 'client_name']);
    ws.addRow(['10000000000001', 'ALPHA']);
    await wb.xlsx.writeFile(file);

    let norm: string[] | null = null;
    const rows: unknown[][] = [];
    const found = await streamXlsxRowsViaUnzipper(file, {
      isHeaderRow: (h) => { norm = normalizePortfolioHeader(h); return norm !== null; },
      onRow: (_h, values) => { rows.push(values); },
    });
    await fs.rm(dir, { recursive: true, force: true });

    expect(found).toBe(true);
    expect(norm).toEqual(['pinfl', 'client_name']);
    expect(rows).toEqual([['10000000000001', 'ALPHA']]);
  });
});
