/**
 * What may be attached to a workflow step. Edge-safe and pure — the browser checks these to
 * give an answer before a 10 MB upload, and the route checks them again because a client-side
 * check is a courtesy, not a control.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PER_ARIZA = 10;

/**
 * Allowlist, not a blocklist. Each entry maps to the extension we store the file under, so the
 * name on disk never comes from the uploader.
 *
 * No SVG and no HTML: both can carry script, and these files are served back to a signed-in
 * yurist/admin/rahbar — an attachment must not be able to run code in their session.
 */
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
};

/** For the file input's `accept`. */
export const ACCEPT_ATTR = Object.keys(ALLOWED).join(',');

export const isImageMime = (mime: string) => mime.startsWith('image/');

/** The extension to store under — derived from the type, never from the client's filename. */
export function safeExt(mime: string, _fileName: string): string {
  return ALLOWED[mime] ?? 'bin';
}

/** First problem with the file, or null. */
export function attachmentError(f: { name: string; type: string; size: number }): string | null {
  if (!ALLOWED[f.type]) {
    return `Fayl turi qabul qilinmaydi: ${f.name}. Rasm, PDF, Word yoki Excel yuboring.`;
  }
  if (f.size === 0) return `Fayl boʻsh: ${f.name}`;
  if (f.size > MAX_FILE_BYTES) return `Fayl 10 MB dan katta: ${f.name}`;
  return null;
}
