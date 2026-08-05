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

/**
 * Builds the ZIP-relative path for one ariza .docx in the bulk export folder tree:
 * `DD.MM.YY/client pinfl/firm/ldId client.docx`, with illegal filesystem characters sanitized.
 */
export function arizaZipPath(
  reportDate: Date,
  clientName: string,
  pinfl: string,
  firmShortName: string,
  ldId: string,
): string {
  const client = clean(clientName);
  return `${ddmmyy(reportDate)}/${client} ${pinfl}/${clean(firmShortName)}/${clean(ldId)} ${client}.docx`;
}
