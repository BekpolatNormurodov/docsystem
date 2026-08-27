// Parses the exclusion/problem-clients xlsx uploaded alongside the portfolio on import. Its
// pinfls are excluded from Hujjatlar/ariza export only (they still appear in Mijozlar/Portfel).
import Excel from 'exceljs';
import { isPinflHeader, pinflColumnIndex } from './pinfl-header';

/**
 * Opens the (small, ~180KB) exclusion xlsx and returns the Set of pinfl strings found in its
 * PINFL worksheet. Detection is script- and case-insensitive (Latin PINFL/PNFL and Cyrillic
 * ПИНФЛ/ПНФЛ, any case, decorated or not — see `pinfl-header.ts`): first a sheet whose NAME reads
 * like PINFL, else the sheet whose header row carries a PINFL column (most rows wins). The matched
 * column is read (not blindly column 1), so a list with leading «№» columns still works.
 */
export async function parseExclusionPinfls(filePath: string): Promise<Set<string>> {
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(filePath);

  const found = pickWorksheet(workbook);
  const pinfls = new Set<string>();
  if (!found) {
    // NEVER silently return an empty set — that would treat "PINFL column not found" as "nobody is
    // excluded", and every do-not-sue client would be sued. Fail loud so the operator rechecks.
    throw new Error('Istisno faylida «PINFL» / «ПНФЛ» ustuni topilmadi — fayl formatini tekshiring');
  }

  const { worksheet, col } = found;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const str = cellStr(row.getCell(col)).trim();
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

function pickWorksheet(workbook: Excel.Workbook): { worksheet: Excel.Worksheet; col: number } | undefined {
  // 1) A sheet whose NAME reads like PINFL (either script/case) — its list is in column 1.
  const byName = workbook.worksheets.find((ws) => isPinflHeader(ws.name));
  if (byName) {
    const named = columnFromHeader(byName);
    return { worksheet: byName, col: named > 0 ? named : 1 };
  }

  // 2) Fallback: any sheet whose header ROW carries a PINFL column (Latin PINFL/PNFL or Cyrillic
  //    ПИНФЛ/ПНФЛ, any case, decorated or not), preferring the one with the most rows. Read the header
  //    via cellStr (rich-text/formula aware) — a bold/rich-text header deserializes to an OBJECT, and
  //    missing it would silently drop the entire exclusion list.
  const candidates = workbook.worksheets
    .map((ws) => ({ ws, col: columnFromHeader(ws) }))
    .filter((c) => c.col > 0);
  if (candidates.length === 0) return undefined;
  const best = candidates.reduce((a, b) => (b.ws.rowCount > a.ws.rowCount ? b : a));
  return { worksheet: best.ws, col: best.col };
}

/** 1-based index of the PINFL column in a sheet's header row (exceljs is 1-indexed), or -1. Scans the
 *  first ~40 header cells so a PINFL column past leading «№»/name columns is still found. */
function columnFromHeader(ws: Excel.Worksheet): number {
  const header = ws.getRow(1);
  const cells: string[] = [];
  for (let c = 1; c <= 40; c += 1) cells.push(cellStr(header.getCell(c)));
  const idx = pinflColumnIndex(cells); // 0-based
  return idx < 0 ? -1 : idx + 1; // → 1-based for exceljs
}
