// One ideal PINFL-column detector, shared by every place that reads a "PINFL list" xlsx (the istisno
// / sud exclusion file and the talabnoma manba list). These small files carry a single identifier
// column whose header appears in many spellings across exports:
//   · Latin:    PINFL, PNFL, pinfl, pnfl  (with/without the «I»)
//   · Cyrillic: ПИНФЛ, ПНФЛ, пинфл, пнфл
//   · decorated: «№ ПНФЛ», «PINFL(ЖШШИР)», «П.И.Н.Ф.Л», etc.
// A too-strict check (e.g. Cyrillic-only, or exact lowercase «pinfl») silently drops the whole list —
// which, for the exclusion file, means do-not-sue clients get sued. So normalize hard, then match.

/** Canonicalize a header/sheet label: uppercase, fold look-alike Cyrillic → Latin, keep only letters.
 *  «ПИНФЛ» → "PINFL", «№ PNFL(ЖШШИР)» → "PNFLJSHSHIR", «п.н.ф.л» → "PNFL". */
export function canonHeader(v: unknown): string {
  const s = String(v ?? '').toUpperCase();
  // Cyrillic → Latin for the letters that spell P-I-N-F-L (and a few neighbours that show up in
  // decorated headers), so both scripts collapse to the same canonical token.
  const folded = s.replace(/[А-ЯЁ]/g, (ch) => CYR_TO_LAT[ch] ?? ch);
  return folded.replace(/[^A-Z0-9]/g, '');
}

const CYR_TO_LAT: Record<string, string> = {
  П: 'P', И: 'I', Н: 'N', Ф: 'F', Л: 'L',
  Ж: 'J', Ш: 'S', Р: 'R', С: 'S', О: 'O',
};

/** Does this single header/sheet label denote a PINFL column? Accepts PINFL or PNFL (with optional
 *  decoration around it), in either script and any case. */
export function isPinflHeader(v: unknown): boolean {
  const c = canonHeader(v);
  return c.includes('PINFL') || c.includes('PNFL');
}

/** Index (0-based) of the first PINFL column in a header row, or -1. Used when reading a list file by
 *  column rather than assuming column 1. */
export function pinflColumnIndex(header: readonly unknown[]): number {
  return header.findIndex((h) => isPinflHeader(h));
}
