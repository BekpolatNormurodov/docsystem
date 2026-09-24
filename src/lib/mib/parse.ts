// Parse a HISOBOT-style .xlsx into MIB client rows. Columns are matched by header text (Cyrillic/Latin
// mix). Ikki formatni QO'LLAB-QUVVATLAYDI:
//   (1) mib.uz HISOBOT eksporti — bitta varaq, sarlavha 1-qatorda, «Holat» ustuni bor.
//   (2) portfel eksporti — ko'p varaqli (Анкета + ПНФЛ + muddati bo'yicha 90+/60-90/30-60 buketlar),
//       sarlavha 2-qatorda, PINFL ustuni «ПНФЛ» deb yozilgan, «Holat» ustuni YO'Q (varaq NOMI = holat).
// Sarlavhа qatori har varaqда qidiriladi (1..25). «Анкета» (xom kredit portfeli — ФИО ustuni yo'q,
// bir odam bir necha qator) va yig'indi varaqlar (PINFL/ФИО yo'q) O'TKAZIB YUBORILADI. Ko'p varaq
// mos kelsa va ba'zilarida «Манзил» bo'lsa — faqat o'shalar (batafsil buketlar) olinadi. PINFL bo'yicha
// varaqlararo dublikat olib tashlanadi.
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

// PINFL sinonimlari — 5+ xil (uzb/rus, katta/kichik farqi norm bilan hal, qavsli variantlar findCol
// substring fallback bilan hal). «Ж.Ш.Ш.И.Р» — davlat guvohnomasi shakli, «ID / IDN» — eng qisqa.
const PINFL_NAMES = ['PINFL', 'PNFL', 'ПИНФЛ', 'ПНФЛ', 'ЖШШИР', 'JSHSHIR', 'ЖШШР', 'IDN'];
// F.I.O sinonimlari — HISOBOT'да «Javobgar» (mijoz nomi) ham ishlatiladi; Qarzdor/Aybdor/Fuqaro
// variantlari ham. Debtor/Ф.И.О — chet el/rasmiy.
const FIO_NAMES = ['F.I.SH.', 'FISH', 'F.I.O', 'F.I.O.', 'ФИО', 'F I SH', 'FIO', 'Javobgar', 'Жавобгар', 'Qarzdor', 'Қарздор', 'Aybdor', 'Айбдор', 'Fuqaro', 'Фуқаро', 'Ismi sharif', 'Ismisharif', 'Debtor', 'Должник'];
const PHONE_NAMES = ['Тел', 'Tel', 'Телефон', 'Phone', 'Тел номер', 'Тел. номер', 'Telefon', 'Telefon raqam', 'Тел раками'];
const FIRM_NAMES = ['MKO', 'МКО', 'Firma', 'МКО_Анкета', 'Фирма'];
const ISH_NAMES = ['Ish raqami', 'Иш рақами', 'Ish raqami ', 'Ish №', 'Иш №'];
// «Holati (MIB)» kabi qavsli variantlar — norm qavsni yo'q qiladi, va findCol substring fallback ishlatadi.
const HOLAT_NAMES = ['Holat', 'Холат', 'Holati', 'Xolat', 'Ҳолат', 'Status', 'Статус'];
const REGION_NAMES = ['Viloyat', 'Вилоят', 'Область', 'Регион', 'Hudud', 'Ҳудуд', 'Hududi'];
const ADDR_NAMES = ['Манзил', 'Manzil', 'Address', 'Адрес', 'Yashash manzili'];
const DEBT_NAMES = ['Жами карздорлик', 'Jami qarzdorlik', 'Умумий кредит карз', 'Жами карзи Асосий', 'Жами карзи', 'Муддати утган карз', 'Qarzdorligi', 'Қарздорлиги', 'Qarz'];
const SENT_NAMES = ['Yuborilgan sana', 'Юборилган сана', 'Ish ko`ril(adi)gan', 'Yuborilgan', 'Ish ko\'rilgan sana', 'Иш кўрилган сана', 'Ish korilgan sana'];

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

// Sarlavha nomlarini solishtirish uchun normallashtirish: kichik harfga + probel, nuqta, tinish
// belgilari, qavslar, tirelar, \n olib tashlanadi. «Holati (MIB)» ↔ «holatimib»; «F.I.O» ↔ «fio»;
// «Ish ko'rilgan sana» ↔ «ishkorilgansana». Boshqa mumkin qavsli qo'shimchalar («... (2)», «... MIB»)
// baribir qavs ichida — tozalanadi.
const norm = (s: string) => s.toLowerCase().replace(/[\s.`'`\n()[\]{}\-_/\\,;:!?"«»""]/g, '');

/** Find the 1-based column index whose header matches any of `names` (first match wins).
 *  1) Exact normalized match ("Holati (MIB)" → "holatimib" matches "Holati" → "holati" after includes).
 *     Chunki qavslar tozalanadi, «Holati (MIB)» → «holatimib» → «holati» substring bo'ladi.
 *  2) Substring fallback — mavjud sarlavha ichida qidirilgan nom TO'LIQ SO'Z sifatida uchrasa.
 *     Faqat wanted uzunligi ≥3 bo'lganda (qisqa sinonimlar false positive bermasin). */
function findCol(header: (string | null)[], names: string[]): number {
  const wanted = names.map(norm);
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (h && wanted.includes(norm(h))) return i + 1;
  }
  // Substring fallback — «Ish raqami (MIB)», «F.I.O — 1» va h.k. uchun.
  for (let i = 0; i < header.length; i++) {
    const h = header[i]; if (!h) continue;
    const nh = norm(h);
    for (const w of wanted) {
      if (w.length >= 3 && nh.includes(w)) return i + 1;
    }
  }
  return 0;
}

/** Read one row (1-based) into a 0-based array of cell texts. */
function readRow(ws: ExcelJS.Worksheet, rowNo: number, maxCols: number): (string | null)[] {
  const out: (string | null)[] = [];
  const row = ws.getRow(rowNo);
  for (let c = 1; c <= maxCols; c++) out[c - 1] = unwrap(row.getCell(c).value);
  return out;
}

interface SheetHeader { ws: ExcelJS.Worksheet; headerRow: number; header: (string | null)[]; hasAddr: boolean }

/** In a worksheet, find the header row (1..25) that has BOTH a PINFL and an FIO column. */
function detectHeader(ws: ExcelJS.Worksheet): SheetHeader | null {
  const maxCols = Math.min(40, Math.max(1, ws.columnCount || 1));
  const scan = Math.min(25, ws.rowCount || 0);
  for (let r = 1; r <= scan; r++) {
    const header = readRow(ws, r, maxCols);
    if (findCol(header, PINFL_NAMES) && findCol(header, FIO_NAMES)) {
      return { ws, headerRow: r, header, hasAddr: !!findCol(header, ADDR_NAMES) };
    }
  }
  return null;
}

export async function parseHisobot(filePath: string): Promise<MibParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const empty: MibParseResult = { rows: [], holatValues: [], sentDateRange: { min: null, max: null } };
  if (!wb.worksheets.length) return empty;

  // 1) Har varaqда sarlavha (PINFL + ФИО) qatorini top. Topilmaganlar (Анкета — ФИО yo'q, yig'indi
  //    varaqlar) tashlanadi.
  let sheets = wb.worksheets.map(detectHeader).filter(Boolean) as SheetHeader[];
  if (!sheets.length) return empty;
  // 2) Bir nechta varaq mos kelsa VA ba'zilarida «Манзил» bo'lsa — faqat batafsillari (muddati bo'yicha
  //    buketlar: 90+/60-90/30-60). Bu «ПНФЛ» birlashtirilgan varag'ini chiqarib, aniq 2716 beradi.
  //    Bitta varaq (eski HISOBOT formati) bo'lsa — «Манзил» sharti qo'yilmaydi.
  if (sheets.length > 1 && sheets.some((s) => s.hasAddr)) sheets = sheets.filter((s) => s.hasAddr);

  const rows: MibParsedRow[] = [];
  const seen = new Set<string>(); // varaqlararo dublikat PINFL
  const holatCounts = new Map<string, number>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const { ws, headerRow, header } of sheets) {
    const cPinfl = findCol(header, PINFL_NAMES);
    const cFio = findCol(header, FIO_NAMES);
    const cPhone = findCol(header, PHONE_NAMES);
    const cFirm = findCol(header, FIRM_NAMES);
    const cIsh = findCol(header, ISH_NAMES);
    const cHolat = findCol(header, HOLAT_NAMES);
    const cRegion = findCol(header, REGION_NAMES);
    const cAddr = findCol(header, ADDR_NAMES);
    // Qarz ustuni nomlari juda xilma-xil (ў/у, «\n», «Асосий») — aniq mos kelmasa, «...карз...»
    // (yoki lotin «qarz») bo'lgan birinchi ustunni olamiz.
    const cDebt = findCol(header, DEBT_NAMES) || (header.findIndex((h) => h && /карз|qarz/i.test(norm(h))) + 1);
    const cSent = findCol(header, SENT_NAMES);
    const sheetHolat = (ws.name || '').trim() || null; // «Holat» ustuni yo'q bo'lsa — varaq nomi

    const lastRow = ws.rowCount || 0;
    for (let r = headerRow + 1; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const pinflRaw = cPinfl ? unwrap(row.getCell(cPinfl).value) : null;
      const pinfl = pinflRaw ? pinflRaw.replace(/\D/g, '') : '';
      if (!pinfl || pinfl.length < 14) continue; // PINFLsiz qatorlar (yig'indi/bo'sh) tashlanadi
      if (seen.has(pinfl)) continue; // varaqlararo dublikat
      seen.add(pinfl);
      const holat = (cHolat ? unwrap(row.getCell(cHolat).value) : null) || sheetHolat;
      if (holat) holatCounts.set(holat, (holatCounts.get(holat) ?? 0) + 1);
      const sentDate = cSent ? toIsoDate(row.getCell(cSent).value) : null;
      if (sentDate) { if (!minDate || sentDate < minDate) minDate = sentDate; if (!maxDate || sentDate > maxDate) maxDate = sentDate; }
      rows.push({
        rowNo: rows.length + 1,
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
    }
  }

  const holatValues = [...holatCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  return { rows, holatValues, sentDateRange: { min: minDate, max: maxDate } };
}
