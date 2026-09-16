// Undiruvchi (kreditor) MASKA'langan nomini BIZNING firmalar bilan solishtirish. MIB qidiruv
// natijasida kreditor «"B***HT FU***RE FI***NG…"» ko'rinishida keladi — har so'zning boshi va oxiri
// ochiq, o'rtasi *** bilan berkitilgan. Shu asosda ishning bizning biror firmamizники (BRIGHT / URBAN /
// COMMUNITY / …) yoki boshqa kreditor (bank / «Давлат»)ники ekanini SMS'дан OLDIN aniqlaymiz — natijada
// faqat bizникиni chuqur (SMS bilan) tortamiz, boshqasini emas (zapros/vaqt tejaladi).

// Firma nomidagi «generik» (huquqiy shakl) so'zlar — solishtirishда tashlanadi.
const GENERIC = new Set([
  'MMT', 'MCHJ', 'MFO', 'LLC', 'OOO', 'ООО', 'MASULIYATI', 'CHEKLANGAN', 'JAMIYAT',
  'MIKROMOLIYA', 'TASHKILOTI', 'MICROCREDIT', 'ORGANIZATION',
]);

/** Firma nomidan farqlovchi (generik bo'lmagan) so'zlarni ajratadi, masalan «BRIGHT FUTURE FINANCING». */
export function firmKeyWords(name: string): string[] {
  return (name || '')
    .replace(/["«»'']/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !GENERIC.has(w.toUpperCase()));
}

/** MASKA bo'lagini («B***HT») regexga aylantiradi — boshi/oxiri qat'iy, o'rtasi ixtiyoriy. */
function fragRegex(frag: string): RegExp {
  const body = frag
    .replace(/["«»'']/g, '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*+/g, '.*');
  return new RegExp('^' + body + '$', 'i');
}

/**
 * MASKA'langan kreditor bizning firmalardan biriga mos keladimi. `firmWordsList` — har firmaning
 * farqlovchi so'zlari (firmKeyWords). Kreditorning BOSHIDAN boshlab bo'laklari biror firma so'zlariga
 * ketma-ket mos kelsa — BIZНИКИ (firma brend-nomi legal nomning boshida, tirnoq ichida keladi).
 */
export function creditorIsOurs(creditor: string | null | undefined, firmWordsList: string[][]): boolean {
  if (!creditor) return false;
  const mask = creditor.replace(/["«»'']/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!mask.length) return false;
  for (const fw of firmWordsList) {
    if (!fw.length || fw.length > mask.length) continue;
    let ok = true;
    for (let i = 0; i < fw.length; i++) {
      if (!fragRegex(mask[i]!).test(fw[i]!)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
