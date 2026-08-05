// Formatting for the Cyrillic "qarzdorlik yo'qligi" maʼlumotnoma. The document itself is
// rendered by CertificateDocument; these are the pieces it cannot express as markup.

/** One contract the maʼlumotnoma covers, as the document prints it. */
export interface DocContract {
  number: string;
  date: Date;
}

/** Date as "DD.MM.YYYY" using UTC (date-only values are stored at UTC midnight). */
export function dmy(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}.${m}.${date.getUTCFullYear()}`;
}

/** Uzbek-Cyrillic month names, as used in the source .docx ("июнь"). */
export const UZ_MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
] as const;

/** Long date exactly as the .docx writes it: "2026 йил 26 июнь". */
export function uzLongDate(date: Date): string {
  return `${date.getUTCFullYear()} йил ${date.getUTCDate()} ${UZ_MONTHS[date.getUTCMonth()]}`;
}

/**
 * "2026 йил 26 июнь" -> "2026-06-26", and "" for anything that cannot be read as a whole date.
 *
 * The inverse of uzLongDate, so the phrase the yurist types stays the thing that prints while
 * `asOfDate` follows along behind it. Deliberately forgiving about spacing and case and nothing
 * else: a phrase that does not name a real day must come back empty rather than be guessed at,
 * because the caller keeps the previous date when it does.
 */
export function uzLongDateToIso(text: string): string {
  const m = /^\s*(\d{4})\s*йил\s*(\d{1,2})\s*([а-яёўқғҳ]+)\s*$/i.exec(text.trim());
  if (!m) return '';
  const year = Number(m[1]);
  const day = Number(m[2]);
  const month = UZ_MONTHS.findIndex((name) => name === m[3]!.toLowerCase());
  if (month < 0 || day < 1 || year < 1900 || year > 2999) return '';
  const d = new Date(Date.UTC(year, month, day));
  // Date rolls 31 June into July; a maʼlumotnoma must not quietly name a different day.
  if (d.getUTCDate() !== day || d.getUTCMonth() !== month) return '';
  return d.toISOString().slice(0, 10);
}

/** Group a numeric amount string with spaces: "4000000" -> "4 000 000". */
export function formatSum(amount: string): string {
  const n = String(amount).replace(/[^\d]/g, '');
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * '«Микроқарз» универсал шартномаси' → '«Микроқарз» универсал шартномалари'.
 *
 * Every blank opens in the plural («…шартномаларига асосан умумий») and closes in the
 * singular («…шартномасига асосан қарздорлиги»), and does so whether it lists one contract
 * or two — the form is fixed by the template, not by the count.
 *
 * 'Shartnoma turi' is a free-text field, so a value that does not end in the -си possessive
 * is returned untouched rather than guessed at.
 */
export function contractTypePlural(contractType: string): string {
  return contractType.replace(/си$/, 'лари');
}

/* ── Latin script (the «Savdo-sanoat palatasiga ariza» is Latin, unlike the Cyrillic maʼlumotnoma) ── */

/** Uzbek-Latin month names, nominative, as the ariza blank writes them ("iyul"). */
export const UZ_MONTHS_LATIN = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
] as const;

/** Long date as the ariza writes it: "2026 yil 15 iyul". Latin sibling of {@link uzLongDate}. */
export function uzLongDateLatin(date: Date): string {
  return `${date.getUTCFullYear()} yil ${date.getUTCDate()} ${UZ_MONTHS_LATIN[date.getUTCMonth()]}`;
}

/**
 * "2026 yil 15 iyul" -> "2026-07-15", and "" for anything that cannot be read as a whole date.
 *
 * The inverse of {@link uzLongDateLatin} — the ariza's «... holatiga koʻra» phrase is what prints and
 * `asOfDate` follows it. Forgiving of spacing and case only; a phrase that does not name a real day
 * comes back empty rather than guessed at, because the caller keeps the previous date when it does.
 */
export function uzLongDateLatinToIso(text: string): string {
  const m = /^\s*(\d{4})\s*yil\s*(\d{1,2})\s*([a-zʻ']+)\s*$/i.exec(text.trim());
  if (!m) return '';
  const year = Number(m[1]);
  const day = Number(m[2]);
  const month = UZ_MONTHS_LATIN.findIndex((name) => name === m[3]!.toLowerCase());
  if (month < 0 || day < 1 || year < 1900 || year > 2999) return '';
  const d = new Date(Date.UTC(year, month, day));
  // Date rolls 31 Feb into March; the ariza must not quietly name a different day.
  if (d.getUTCDate() !== day || d.getUTCMonth() !== month) return '';
  return d.toISOString().slice(0, 10);
}

/** The ariza header date: «"15"  iyul 2026-yil» (two spaces, as the blank has it). */
export function arizaHeaderDate(date: Date): string {
  return `"${date.getUTCDate()}"  ${UZ_MONTHS_LATIN[date.getUTCMonth()]} ${date.getUTCFullYear()}-yil`;
}

/* ── Decimal money (the ariza carries tiyin: "24 318 882,63" — space thousands, comma decimal) ── */

/** Group an integer string with spaces: "24318882" -> "24 318 882". */
function groupThousands(intPart: string): string {
  return (intPart.replace(/\D/g, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** "24318882.63" | "24318882,63" -> "24 318 882,63"; a whole amount has no comma. */
export function formatSumDecimal(value: string): string {
  const s = String(value).replace(/\s/g, '').replace(',', '.');
  const [int = '0', frac] = s.split('.');
  const grouped = groupThousands(int);
  return frac && Number(frac) !== 0 ? `${grouped},${frac.replace(/\D/g, '').slice(0, 2)}` : grouped;
}

/** Editor input: keep digits + one comma, ≤2 decimals, space-group the integer part. */
export function maskAmountDecimal(v: string): string {
  const cleaned = v.replace(/[^\d,]/g, '');
  const [int = '', ...rest] = cleaned.split(',');
  const frac = rest.join('').slice(0, 2);
  const grouped = groupThousands(int.replace(/^0+(?=\d)/, ''));
  return cleaned.includes(',') ? `${grouped},${frac}` : grouped;
}

/** "24 318 882,63" -> "24318882.63" (dot decimal, for Prisma.Decimal / the API). */
export function unmaskAmountDecimal(v: string): string {
  const s = v.replace(/\s/g, '').replace(',', '.');
  const [int = '0', frac] = s.split('.');
  const cleanInt = int.replace(/\D/g, '') || '0';
  return frac ? `${cleanInt}.${frac.replace(/\D/g, '').slice(0, 2)}` : cleanInt;
}
