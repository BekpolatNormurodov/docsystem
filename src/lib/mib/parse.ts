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
  sentDate: string | null; // «Yuborilgan sana» → ISO YYYY-MM-DD (date filter)
}

export interface MibParseResult {
  rows: MibParsedRow[];
  holatValues: { value: string; count: number }[]; // distinct «Holat» values for the filter
  sentDateRange: { min: string | null; max: string | null }; // for the date picker hints
}

/** Normalize HISOBOT's mixed date shapes (Date, «DD-MM-YYYY», «YYYY-MM-DD …», Excel serial) → ISO date. */
function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if (o.result !== undefined) return toIsoDate(o.result);
    if (o.text !== undefined) return toIsoDate(o.text);
    return null;
  }
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
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
  if (!ws) return { rows: [], holatValues: [], sentDateRange: { min: null, max: null } };

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
  const cSent = findCol(header, ['Yuborilgan sana', 'Юборилган сана', 'Ish ko`ril(adi)gan', 'Yuborilgan']);

  const rows: MibParsedRow[] = [];
  const holatCounts = new Map<string, number>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const pinflRaw = cPinfl ? unwrap(row.getCell(cPinfl).value) : null;
    const pinfl = pinflRaw ? pinflRaw.replace(/\D/g, '') : '';
    if (!pinfl || pinfl.length < 14) return; // skip rows without a valid PINFL
    const holat = cHolat ? unwrap(row.getCell(cHolat).value) : null;
    if (holat) holatCounts.set(holat, (holatCounts.get(holat) ?? 0) + 1);
    const sentDate = cSent ? toIsoDate(row.getCell(cSent).value) : null;
    if (sentDate) { if (!minDate || sentDate < minDate) minDate = sentDate; if (!maxDate || sentDate > maxDate) maxDate = sentDate; }
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
      sentDate,
    });
  });

  const holatValues = [...holatCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  return { rows, holatValues, sentDateRange: { min: minDate, max: maxDate } };
}
