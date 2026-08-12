// Parses the exclusion/problem-clients xlsx uploaded alongside the portfolio on import. Its
// pinfls are excluded from Hujjatlar/ariza export only (they still appear in Mijozlar/Portfel).
import Excel from 'exceljs';

/**
 * Opens the (small, ~180KB) exclusion xlsx and returns the Set of pinfl strings found in its
 * `Pnfl` worksheet (case-insensitive match on the sheet name containing "pnfl"/"pinfl"; falls
 * back to the sheet whose first header cell is `ПНФЛ` with the most rows). Only column 1
 * (`ПНФЛ`, exceljs is 1-indexed) is read; every other column is ignored.
 */
export async function parseExclusionPinfls(filePath: string): Promise<Set<string>> {
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = pickWorksheet(workbook);
  const pinfls = new Set<string>();
  if (!worksheet) return pinfls;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const str = cellStr(row.getCell(1)).trim();
    if (str) pinfls.add(str);
  });

  return pinfls;
}

/** Read an exceljs cell as text, unwrapping rich-text/formula/hyperlink objects.
 *  Plain String(cell.value) yields "[object Object]" for those, which would drop
 *  a real PINFL from the exclusion set and get an excluded client sued. */
function cellStr(cell: Excel.Cell): string {
  const v = cell.value as any;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text ?? '').join('');
  if (v.text != null) return String(v.text);     // hyperlink cell
  if (v.result != null) return String(v.result); // formula cell
  return cell.text ?? '';                          // last resort (Date, etc.)
}

function pickWorksheet(workbook: Excel.Workbook): Excel.Worksheet | undefined {
  const byName = workbook.worksheets.find((ws) => {
    const name = ws.name.toLowerCase();
    return name.includes('pnfl') || name.includes('pinfl');
  });
  if (byName) return byName;

  // Fallback: the sheet whose row-1 first cell is ПНФЛ, preferring the one with the most rows.
  const candidates = workbook.worksheets.filter((ws) => {
    const first = ws.getRow(1).getCell(1).value;
    return typeof first === 'string' && first.trim().toUpperCase() === 'ПНФЛ';
  });
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, ws) => (ws.rowCount > best.rowCount ? ws : best));
}
