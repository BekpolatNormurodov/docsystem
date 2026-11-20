// Portfel sarlavha qatorini tanish. Ustunlar mapRowToLoan'da aniq kichik-harfli nom bilan o'qiladi
// (pinfl, client_name, branch …), shuning uchun sarlavha trim + kichik harfga keltiriladi; PINFL ustuni
// esa har xil yozuvda kelishi mumkin («PINFL», «ПИНФЛ», «П.И.Н.Ф.Л») — u «pinfl» ga almashtiriladi.
import { canonHeader } from '@/lib/pinfl-header';

/** Sarlavha fayl boshidagi nechta qator ichidan qidiriladi (tepada nom/bo'sh qator bo'lishi mumkin). */
export const HEADER_SCAN_ROWS = 10;

/** Qator portfel sarlavhasi bo'lsa — normallashtirilgan sarlavha (ichida «pinfl» bor), aks holda null. */
export function normalizePortfolioHeader(values: readonly unknown[]): string[] | null {
  const h = Array.from(values, (v) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase()));
  if (h.includes('pinfl')) return h;
  // Aniq «pinfl» yo'q → faqat PINFL/PNFL ning o'zi bo'lgan ustun (bezakli «pinfl_kafil» kabilar emas).
  const idx = h.findIndex((c) => {
    const canon = canonHeader(c);
    return canon === 'PINFL' || canon === 'PNFL';
  });
  if (idx < 0) return null;
  h[idx] = 'pinfl';
  return h;
}

/** Xato matni uchun: qatordagi bo'sh bo'lmagan dastlabki ustun nomlari. */
export function headerSample(values: readonly unknown[], max = 8): string[] {
  return Array.from(values, (v) => (v === null || v === undefined ? '' : String(v).trim()))
    .filter(Boolean)
    .slice(0, max)
    .map((s) => (s.length > 30 ? `${s.slice(0, 30)}…` : s));
}
