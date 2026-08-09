// Whole-number -> Uzbek (Cyrillic) words, for the talabnoma "…so'zda" columns.
// Verified against the BRIGHT sample: 6000000 -> "олти миллион",
// 115709 -> "бир юз ўн беш минг етти юз тўққиз",
// 52300000 -> "эллик икки миллион уч юз минг".
//
// (The source Excel had a typo "тўксон" for 90; we emit the correct "тўқсон".)

const ONES = ['', 'бир', 'икки', 'уч', 'тўрт', 'беш', 'олти', 'етти', 'саккиз', 'тўққиз'];
const TENS = ['', 'ўн', 'йигирма', 'ўттиз', 'қирқ', 'эллик', 'олтмиш', 'етмиш', 'саксон', 'тўқсон'];
const SCALES = ['', 'минг', 'миллион', 'миллиард', 'триллион'];

// 1..999 -> words
function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) parts.push(ONES[h], 'юз');
  if (t) parts.push(TENS[t]);
  if (o) parts.push(ONES[o]);
  return parts.join(' ');
}

export function numberToUzWords(value: number | string): string {
  let n = Math.floor(Math.abs(Number(value)));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'ноль';

  // Split into 3-digit groups, least-significant first.
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }

  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    out.push(under1000(g));
    if (SCALES[i]) out.push(SCALES[i]);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
