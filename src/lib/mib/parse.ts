// Parse a HISOBOT-style .xlsx (like «HISOBOT 120.xlsx») into MIB client rows. Columns are matched by
// header text (Cyrillic/Latin mix). The «Holat» column drives the status filter (e.g. «MIBda»).
import ExcelJS from 'exceljs';

export interface MibParsedRow {
  rowNo: number | null;
  pinfl: string;
  fio: string | null;
  phone: string | null;
  firm: string | null; // MKO
  ishRaqami: string | null;
  holat: string | null;
  region: string | null;
  address: string | null;
  totalDebtSrc: string | null;
}

export interface MibParseResult {
  rows: MibParsedRow[];
  holatValues: { value: string; count: number }[]; // distinct «Holat» values for the filter
}

function unwrap(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r?.text ?? '').join('').trim() || null;
    if (o.result !== undefined) return o.result === null ? null : String(o.result).trim() || null;
    if (o.text !== undefined) return String(o.text).trim() || null;
    return null;
  }
  return String(v).trim() || null;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s.`']/g, '');

/** Find the 1-based column index whose header matches any of `names` (first match wins). */
function findCol(header: (string | null)[], names: string[]): number {
  const wanted = names.map(norm);
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (h && wanted.includes(norm(h))) return i + 1;
  }
  return 0;
}

export async function parseHisobot(filePath: string): Promise<MibParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], holatValues: [] };

  const headerRow = ws.getRow(1);
  const header: (string | null)[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => { header[col - 1] = unwrap(cell.value); });

  const cPinfl = findCol(header, ['PINFL', 'ПИНФЛ', 'ЖШШИР']);
  const cFio = findCol(header, ['F.I.SH.', 'FISH', 'F.I.O', 'ФИО', 'F I SH']);
  const cPhone = findCol(header, ['Тел', 'Tel', 'Телефон', 'Phone']);
  const cFirm = findCol(header, ['MKO', 'МКО', 'Firma']);
  const cIsh = findCol(header, ['Ish raqami', 'Иш рақами', 'Ish raqami ']);
  const cHolat = findCol(header, ['Holat', 'Холат', 'Holati']);
  const cRegion = findCol(header, ['Viloyat', 'Вилоят', 'Область']);
  const cAddr = findCol(header, ['Манзил', 'Manzil', 'Address']);
  const cDebt = findCol(header, ['Жами карздорлик', 'Jami qarzdorlik', 'Умумий кредит карз']);

  const rows: MibParsedRow[] = [];
  const holatCounts = new Map<string, number>();

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const pinflRaw = cPinfl ? unwrap(row.getCell(cPinfl).value) : null;
    const pinfl = pinflRaw ? pinflRaw.replace(/\D/g, '') : '';
    if (!pinfl || pinfl.length < 14) return; // skip rows without a valid PINFL
    const holat = cHolat ? unwrap(row.getCell(cHolat).value) : null;
    if (holat) holatCounts.set(holat, (holatCounts.get(holat) ?? 0) + 1);
    rows.push({
      rowNo: cPinfl ? Number(unwrap(row.getCell(1).value)) || rowNumber - 1 : rowNumber - 1,
      pinfl,
      fio: cFio ? unwrap(row.getCell(cFio).value) : null,
      phone: cPhone ? unwrap(row.getCell(cPhone).value) : null,
      firm: cFirm ? unwrap(row.getCell(cFirm).value) : null,
      ishRaqami: cIsh ? unwrap(row.getCell(cIsh).value) : null,
      holat,
      region: cRegion ? unwrap(row.getCell(cRegion).value) : null,
      address: cAddr ? unwrap(row.getCell(cAddr).value) : null,
      totalDebtSrc: cDebt ? unwrap(row.getCell(cDebt).value) : null,
    });
  });

  const holatValues = [...holatCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  return { rows, holatValues };
}
