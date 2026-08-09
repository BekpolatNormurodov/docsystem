// Uzbek Latin -> Cyrillic transliteration, for the talabnoma receiver/address
// (docsystem stores Latin; the hippo talabnoma is filled in Cyrillic).
//
// Verified against the BRIGHT sample style:
//   RAVSHANOV SHAHBOZ SHUXRATOVICH -> РАВШАНОВ ШАҲБОЗ ШУХРАТОВИЧ
//   O'RINBAYEV ... O'G'LI          -> ЎРИНБАЕВ ... ЎҒЛИ
//
// Digraphs and the o'/g' apostrophe forms are handled before single letters.

const APO = "'ʻʼ`’‘";                       // all apostrophe variants seen in the data
const isApo = (c: string) => c && APO.includes(c);

// lower-case single-letter map (h->ҳ, x->х, q->қ per Uzbek convention)
const SINGLE: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к',
  l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у',
  v: 'в', w: 'в', x: 'х', y: 'й', z: 'з', c: 'к',
};
// multi-letter (digraph) map, lower-case
const DIGRAPHS: [string, string][] = [
  ['sh', 'ш'], ['ch', 'ч'], ['yo', 'ё'], ['yu', 'ю'], ['ya', 'я'], ['ye', 'е'], ['ts', 'ц'],
];

function matchCase(src: string, out: string): string {
  // Uppercase the Cyrillic result when the source letter(s) were uppercase.
  return /[A-ZА-Я]/.test(src[0]) ? out.toUpperCase() : out;
}

export function latinToCyrillic(input: string): string {
  const s = String(input ?? '');
  let out = '';
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    const low = ch.toLowerCase();

    // o' / g' -> ў / ғ  (letter followed by an apostrophe)
    if ((low === 'o' || low === 'g') && isApo(s[i + 1])) {
      out += matchCase(ch, low === 'o' ? 'ў' : 'ғ');
      i += 2;
      continue;
    }
    // digraphs — but don't let "yo" swallow the o of a "yo'" (Й+Ў) sequence:
    // "YO'LDOSHEV" must be ЙЎЛДОШЕВ, not ЁЛДОШЕВ. Let y fall through to й and the
    // next iteration handle o'→ў.
    const two = s.slice(i, i + 2).toLowerCase();
    const dg = (two === 'yo' && isApo(s[i + 2])) ? undefined : DIGRAPHS.find(([k]) => k === two);
    if (dg) { out += matchCase(s[i], dg[1]); i += 2; continue; }

    // single letters
    if (SINGLE[low]) { out += matchCase(ch, SINGLE[low]); i += 1; continue; }

    // stray apostrophes are dropped; everything else (digits, punctuation, spaces) passes through
    if (isApo(ch)) { i += 1; continue; }
    out += ch;
    i += 1;
  }
  return out;
}
