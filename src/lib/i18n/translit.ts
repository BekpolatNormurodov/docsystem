// Oʻzbek LOTIN → KIRILL transliteratsiya (sayt UI matni uchun). Aniq 1:1 emas — `e`/`ye`
// va oʻzlashma soʻzlarda chekli xatolar boʻlishi mumkin; shuning uchun maxsus soʻzlar CYRL_OVERRIDE
// bilan qoʻlda toʻgʻrilanadi. FAQAT UI matniga qoʻllanadi (hujjat shablonlariga EMAS).

// Aniq transliteratsiya toʻgʻri boʻlmaydigan (koʻpincha oʻzlashma / brend) soʻzlar — butun ibora
// yoki alohida token. Butun matn shu jadvalda boʻlsa — oʻsha ishlatiladi.
export const CYRL_OVERRIDE: Record<string, string> = {
  Invoice: 'Инвойс',
  Excel: 'Excel',
  PDF: 'PDF',
  ADOLAT: 'АДОЛАТ',
  MIB: 'МИБ',
  MFO: 'МФО',
  STIR: 'СТИР',
  PINFL: 'ПИНФЛ',
  JShShIR: 'ЖШШИР',
  Snapshot: 'Снапшот',
};

// Uch va ikki harfli birikmalar (avval eng uzuni). Apostrof variantlari: ' (ASCII), ‘ ’ ʻ ʼ.
const AP = "['‘’ʻʼ]";
const DIGRAPHS: [RegExp, string][] = [
  [new RegExp('O' + AP, 'g'), 'Ў'], [new RegExp('o' + AP, 'g'), 'ў'],
  [new RegExp('G' + AP, 'g'), 'Ғ'], [new RegExp('g' + AP, 'g'), 'ғ'],
  [/Sh/g, 'Ш'], [/SH/g, 'Ш'], [/sh/g, 'ш'],
  [/Ch/g, 'Ч'], [/CH/g, 'Ч'], [/ch/g, 'ч'],
  [/Yo/g, 'Ё'], [/YO/g, 'Ё'], [/yo/g, 'ё'],
  [/Yu/g, 'Ю'], [/YU/g, 'Ю'], [/yu/g, 'ю'],
  [/Ya/g, 'Я'], [/YA/g, 'Я'], [/ya/g, 'я'],
  [/Ts/g, 'Ц'], [/ts/g, 'ц'],
];

const SINGLE: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к',
  l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у',
  v: 'в', x: 'х', y: 'й', z: 'з',
  A: 'А', B: 'Б', D: 'Д', E: 'Е', F: 'Ф', G: 'Г', H: 'Ҳ', I: 'И', J: 'Ж', K: 'К',
  L: 'Л', M: 'М', N: 'Н', O: 'О', P: 'П', Q: 'Қ', R: 'Р', S: 'С', T: 'Т', U: 'У',
  V: 'В', X: 'Х', Y: 'Й', Z: 'З',
};

// Soʻz boshidagi `e` → э (aks holda е). Soʻz boshi = matn boshi yoki harf boʻlmagan belgidan keyin.
function fixInitialE(s: string): string {
  return s.replace(/(^|[^A-Za-z'‘’ʻʼ])([Ee])/g, (_, pre, ch) => pre + (ch === 'E' ? 'Э' : 'э'));
}

/** Lotin oʻzbek matnini kirillga oʻgiradi. Raqam/tinish belgilari va lotin qolgan harflar oʻzgarmaydi. */
export function toCyrl(input: string): string {
  if (!input) return input;
  if (CYRL_OVERRIDE[input] != null) return CYRL_OVERRIDE[input];
  let s = fixInitialE(input);
  for (const [re, rep] of DIGRAPHS) s = s.replace(re, rep);
  let out = '';
  for (const ch of s) out += SINGLE[ch] ?? ch;
  return out;
}
