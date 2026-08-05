/** Sanitizes a path segment: illegal filesystem characters become `_`, whitespace trimmed/collapsed. */
function clean(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .replace(/\s+/g, ' ');
}

function ddmmyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  return `${dd}.${mm}.${yy}`;
}

function ddmmyyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

/**
 * ZIP-relative path for one ariza .docx: `DD.MM.YY/client pinfl/client firm DD.MM.YYYY.docx`.
 * Two folder levels only (date → person); the firm is in the FILE name, not a subfolder. Illegal
 * filesystem characters are sanitized. Names can collide when a client has several arizas at the
 * same firm/date — `uniqueZipPath` disambiguates those.
 */
export function arizaZipPath(reportDate: Date, clientName: string, pinfl: string, firmName: string): string {
  const client = clean(clientName);
  return `${ddmmyy(reportDate)}/${client} ${pinfl}/${client} ${clean(firmName)} ${ddmmyyyy(reportDate)}.docx`;
}

/**
 * Returns `path` if unused, else the same name with a ` (2)`, ` (3)`, … suffix inserted before
 * `.docx`, and records the chosen name in `used`. Prevents same-named arizas overwriting each other
 * in the ZIP (a client with multiple loans at one firm on one date).
 */
export function uniqueZipPath(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const ext = '.docx';
  const base = path.endsWith(ext) ? path.slice(0, -ext.length) : path;
  let k = 2;
  let candidate = `${base} (${k})${ext}`;
  while (used.has(candidate)) {
    k += 1;
    candidate = `${base} (${k})${ext}`;
  }
  used.add(candidate);
  return candidate;
}
