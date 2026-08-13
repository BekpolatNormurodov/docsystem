// Pure helpers to convert a portfolio's Russian/transliterated address into clean Uzbek Latin.
//
// The portfolio already carries the district in Uzbek Cyrillic (`raw.distr_name`, e.g. "ЧУСТ ТУМАНИ")
// and the region in Russian Cyrillic (`regionName`). Region + district are resolved through explicit
// lookup tables — NOT mechanical transliteration — because the Cyrillic here uses simplified Russian
// letters, so a mechanical translit would produce wrong Uzbek spellings ("Kurgontepa" vs the correct
// "Qoʻrgʻontepa"). The remaining tail (mahalla / street / house) is cleaned token-by-token from the
// already-Latin `post_address`. Coverage validated against the live DB: 0 unmapped regions/districts.

const OK = 'ʻ'; // ʻ — Uzbek Latin okina (o‘/g‘)

/** regionName (Russian Cyrillic) → Uzbek Latin. Keyed on the Latin-H/I normalized upper-case form. */
const REGION: Record<string, string> = {
  'НАМАНГАНСКАЯ ОБЛАСТЬ': 'Namangan viloyati',
  'РЕСПУБЛИКА КАРАКАЛПАКСТАН': `Qoraqalpog${OK}iston Respublikasi`,
  'БУХАРСКАЯ ОБЛАСТЬ': 'Buxoro viloyati',
  'ДЖИЗАКСКАЯ ОБЛАСТЬ': 'Jizzax viloyati',
  'ХОРЕЗМСКАЯ ОБЛАСТЬ': 'Xorazm viloyati',
  'САМАРКАНДСКАЯ ОБЛАСТЬ': 'Samarqand viloyati',
  'ГОРОД ТАШКЕНТ': 'Toshkent shahri',
  'НАВОИЙСКАЯ ОБЛАСТЬ': 'Navoiy viloyati',
  'ТАШКЕНТСКАЯ ОБЛАСТЬ': 'Toshkent viloyati',
  'КАШКАДАРЬИННСКАЯ ОБЛАСТЬ': 'Qashqadaryo viloyati',
  'КАШКАДАРЬИНСКАЯ ОБЛАСТЬ': 'Qashqadaryo viloyati', // single-Н spelling (other data sources)
  'АНДИЖАНСКАЯ ОБЛАСТЬ': 'Andijon viloyati',
  'ФЕРГАНСКАЯ ОБЛАСТЬ': `Farg${OK}ona viloyati`,
  'СУРХАНДАРЬИНСКАЯ ОБЛАСТЬ': 'Surxondaryo viloyati',
  'СЫРДАРЬИНСКАЯ ОБЛАСТЬ': 'Sirdaryo viloyati',
};

const g = OK;
/** distr_name base (без ТУМАНИ/ШАХРИ) → Uzbek Latin base. 204 districts, DB-validated. */
const DISTRICT: Record<string, string> = {
  'ЁЗЁВОН': 'Yozyovon', 'АМУДАРЁ': 'Amudaryo', 'АНГОР': 'Angor', 'АНГРЕН': 'Angren', 'АНДИЖОН': 'Andijon',
  'АРНАСОЙ': 'Arnasoy', 'АСАКА': 'Asaka', 'БАЛИКЧИ': 'Baliqchi', 'БАНДИХОН': 'Bandixon', 'БАХМАЛ': 'Baxmal',
  'БЕКОБОД': 'Bekobod', 'БЕКТЕМИР': 'Bektemir', 'БЕШАРИК': 'Beshariq', 'БОЁВУТ': 'Boyovut', 'БОГДОД': `Bog${g}dod`,
  'БОГОТ': `Bog${g}ot`, 'БОЙСУН': 'Boysun', 'БУВАЙДА': 'Buvayda', 'БУЗАТОВ': 'Buzatov', 'БУКА': 'Buka',
  'БУЛОКБОШИ': 'Buloqboshi', 'БУЛУНГУР': `Bulung${g}ur`, 'БУСТОН': `Bo${g}ston`, 'БУСТОНЛИК': `Bo${g}stonliq`, 'БУХОРО': 'Buxoro',
  'ВОБКЕНТ': 'Vobkent', 'ГАЛЛАОРОЛ': `G${g}allaorol`, 'ГИЖДУВОН': `G${g}ijduvon`, 'ГОЗГОН': `G${g}ozg${g}on`, 'ГУЗОР': `G${g}uzor`,
  'ГУЛИСТОН': 'Guliston', 'ГУРЛАН': 'Gurlan', 'ДАНГАРА': `Dang${g}ara`, 'ДЕНОВ': 'Denov', 'ДЕХКОНОБОД': 'Dehqonobod',
  'ДУСТЛИК': `Do${g}stlik`, 'ЖАЛОЛКУДУК': 'Jalolquduq', 'ЖАРКУРГОН': `Jarqo${g}rg${g}on`, 'ЖИЗЗАХ': 'Jizzax', 'ЖОМБОЙ': 'Jomboy',
  'ЖОНДОР': 'Jondor', 'ЗАНГИОТА': 'Zangiota', 'ЗАРАФШОН': 'Zarafshon', 'ЗАРБДОР': 'Zarbdor', 'ЗАФАРОБОД': 'Zafarobod',
  'ЗОМИН': 'Zomin', 'ИЗБОСКАН': 'Izboskan', 'ИШТИХОН': 'Ishtixon', 'КАМАШИ': 'Qamashi', 'КАРМАНА': 'Karmana',
  'КАРШИ': 'Qarshi', 'КАСБИ': 'Kasbi', 'КАТТАКУРГОН': `Kattaqo${g}rg${g}on`, 'КЕГЕЙЛИ': 'Kegeyli', 'КИБРАЙ': 'Qibray',
  'КИЗИЛТЕПА': 'Qiziltepa', 'КИЗИРИК': 'Qizirik', 'КИТОБ': 'Kitob', 'КОГОН': 'Kogon', 'КОНИМЕХ': 'Konimex',
  'КОНЛИКУЛ': `Qonliko${g}l`, 'КОРАКУЛ': `Qorako${g}l`, 'КОРАУЗАК': `Qorao${g}zak`, 'КОРОВУЛБОЗОР': 'Qorovulbozor', 'КОСОН': 'Koson',
  'КОСОНСОЙ': 'Kosonsoy', 'КУВА': 'Quva', 'КУВАСОЙ': 'Quvasoy', 'КУЙИЧИРЧИК': 'Quyichirchiq', 'КУКДАЛА': `Ko${g}kdala`,
  'КУКОН': `Qo${g}qon`, 'КУМКУРГОН': `Qumqo${g}rg${g}on`, 'КУНГИРОТ': `Qo${g}ng${g}irot`, 'КУРГОНТЕПА': `Qo${g}rg${g}ontepa`, 'КУШКУПИР': `Qo${g}shko${g}pir`,
  'КУШРАБОТ': `Qo${g}shrabot`, 'КУШТЕПА': `Qo${g}shtepa`, 'МАРГИЛОН': `Marg${g}ilon`, 'МАРХАМАТ': 'Marhamat', 'МИНГБУЛОК': 'Mingbuloq',
  'МИРЗАОБОД': 'Mirzaobod', 'МИРЗАЧУЛ': `Mirzacho${g}l`, 'МИРЗО УЛУГБЕК': `Mirzo Ulug${g}bek`, 'МИРИШКОР': 'Mirishkor', 'МИРОБОД': 'Mirobod',
  'МУБОРАК': 'Muborak', 'МУЗРАБОТ': 'Muzrabot', 'НАВБАХОР': 'Navbahor', 'НАВОИЙ': 'Navoiy', 'НАМАНГАН': 'Namangan',
  'НАРПАЙ': 'Narpay', 'НИШОН': 'Nishon', 'НОРИН': 'Norin', 'НУКУС': 'Nukus', 'НУРАФШОН': 'Nurafshon',
  'НУРОБОД': 'Nurobod', 'НУРОТА': 'Nurota', 'ОКДАРЁ': 'Oqdaryo', 'ОККУРГОН': `Oqqo${g}rg${g}on`, 'ОКОЛТИН': 'Oqoltin',
  'ОЛМАЗОР': 'Olmazor', 'ОЛМАЛИК': 'Olmaliq', 'ОЛОТ': 'Olot', 'ОЛТИАРИК': 'Oltiariq', 'ОЛТИНКУЛ': `Oltinko${g}l`,
  'ОЛТИНСОЙ': 'Oltinsoy', 'ОХАНГАРОН': 'Ohangaron', 'ПАЙАРИК': 'Payariq', 'ПАРКЕНТ': 'Parkent', 'ПАСТДАРГОМ': `Pastdarg${g}om`,
  'ПАХТАКОР': 'Paxtakor', 'ПАХТАОБОД': 'Paxtaobod', 'ПАХТАЧИ': 'Paxtachi', 'ПЕШКУ': 'Peshku', 'ПОП': 'Pop',
  'ПСКЕНТ': 'Pskent', 'РИШТОН': 'Rishton', 'РОМИТАН': 'Romitan', 'САЙХУНОБОД': 'Sayxunobod', 'САМАРКАНД': 'Samarqand',
  'САРДОБА': 'Sardoba', 'САРИОСИЁ': 'Sariosiyo', 'СИРГАЛИ': `Sirg${g}ali`, 'СИРДАРЁ': 'Sirdaryo', 'ТАЙЛОК': 'Tayloq',
  'ТАХИАТОШ': 'Taxiatosh', 'ТАХТАКУПИР': `Taxtako${g}pir`, 'ТЕРМИЗ': 'Termiz', 'ТОМДИ': 'Tomdi', 'ТОШКЕНТ': 'Toshkent',
  'ТОШЛОК': 'Toshloq', 'ТУПРОККАЛЪА': `Tuproqqal'a`, 'ТУРАКУРГОН': `To${g}raqo${g}rg${g}on`, 'ТУРТКУЛ': `To${g}rtko${g}l`, 'УЗБЕКИСТОН': `O${g}zbekiston`,
  'УЗУН': 'Uzun', 'УЙЧИ': 'Uychi', 'УЛУГНОР': `Ulug${g}nor`, 'УРГАНЧ': 'Urganch', 'УРГУТ': 'Urgut',
  'УРТАЧИРЧИК': `O${g}rtachirchiq`, 'УЧКУДУК': 'Uchquduq', 'УЧКУПРИК': `Uchko${g}prik`, 'УЧКУРГОН': `Uchqo${g}rg${g}on`, 'УЧТЕПА': 'Uchtepa',
  'ФАРГОНА': `Farg${g}ona`, 'ФОРИШ': 'Forish', 'ФУРКАТ': 'Furqat', 'ХАВАСТ': 'Xovos', 'ХАЗОРАСП': 'Xazorasp',
  'ХАТИРЧИ': 'Xatirchi', 'ХИВА': 'Xiva', 'ХОНКА': 'Xonqa', 'ХОНОБОД': 'Xonobod', 'ХУЖАЙЛИ': `Xo${g}jayli`,
  'ХУЖАОБОД': `Xo${g}jaobod`, 'ЧИЛОНЗОР': 'Chilonzor', 'ЧИМБОЙ': 'Chimboy', 'ЧИНОЗ': 'Chinoz', 'ЧИРОКЧИ': 'Chiroqchi',
  'ЧИРЧИК': 'Chirchiq', 'ЧОРТОК': 'Chortoq', 'ЧУСТ': 'Chust', 'ШАЙХОНТОХУР': 'Shayxontohur', 'ШАРОФ РАШИДОВ': 'Sharof Rashidov',
  'ШАХРИСАБЗ': 'Shahrisabz', 'ШАХРИХОН': 'Shahrixon', 'ШЕРОБОД': 'Sherobod', 'ШИРИН': 'Shirin', 'ШОВОТ': 'Shovot',
  'ШОФИРКОН': 'Shofirkon', 'ШУМАНАЙ': 'Shumanay', 'ШУРЧИ': `Sho${g}rchi`, 'ЭЛЛИККАЛА': `Ellikqal'a`, 'ЮКОРИЧИРЧИК': 'Yuqorichirchiq',
  'ЮНУСОБОД': 'Yunusobod', 'ЯККАБОГ': `Yakkabog${g}`, 'ЯККАСАРОЙ': 'Yakkasaroy', 'ЯНГИАРИК': 'Yangiariq', 'ЯНГИБОЗОР': 'Yangibozor',
  'ЯНГИЕР': 'Yangiyer', 'ЯНГИЙУЛ': `Yangiyo${g}l`, 'ЯНГИКУРГОН': `Yangiqo${g}rg${g}on`, 'ЯНГИОБОД': 'Yangiobod', 'ЯНГИХАЁТ': 'Yangihayot',
  'ЯШНОБОД': 'Yashnobod',
};

// The portfolio's Cyrillic occasionally carries Latin look-alikes (H for Н, I for И). Normalize before lookup.
const cyr = (s: string | null | undefined): string =>
  (s ?? '').replace(/H/g, 'Н').replace(/I/g, 'И').toUpperCase().trim();

/** Region (Russian Cyrillic) → Uzbek Latin, or null if unknown. */
export function mapRegion(regionName: string | null | undefined): string | null {
  return REGION[cyr(regionName)] ?? null;
}

/** District (`distr_name`, Uzbek Cyrillic) → Uzbek Latin "X tumani" / "X shahri", or null if unknown. */
export function mapDistrict(distrName: string | null | undefined): string | null {
  let s = cyr(distrName);
  let suffix = '';
  if (/\sТУМАНИ$/.test(s)) { suffix = ' tumani'; s = s.replace(/\sТУМАНИ$/, ''); }
  else if (/\sТУМАН$/.test(s)) { suffix = ' tumani'; s = s.replace(/\sТУМАН$/, ''); }
  else if (/\sШ[АЕ]?ХРИ$/.test(s)) { suffix = ' shahri'; s = s.replace(/\sШ[АЕ]?ХРИ$/, ''); }
  const base = DISTRICT[s.trim()];
  return base ? base + suffix : null;
}

const titleCase = (w: string): string => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w);
const MFY_TYPES = ['MSG', 'MFI', 'MFY', 'MAX', 'MAXALLA', 'MAHALLA'];
const MASSIV_TYPES = ['MASSIV', 'MAVZE', 'MAVE'];
const KEEP_TYPES = ['KFY', 'QFY', 'SSG', 'SHFY', 'FY', 'QMFY']; // locality-type abbreviations, kept upper-case
const NOISE = ['RS', 'R/S', 'B/N', 'BN', 'R-SIZ', 'RSIZ', 'DIERI'];

/**
 * Extract the local part (mahalla / street / house) from `post_address`, already Latin. The leading
 * region+district is dropped (it's authoritative from the structured fields). Cyrillic or lost-char
 * ('?') tails are dropped whole rather than leaking garbage.
 */
export function cleanTail(post: string | null | undefined): string {
  if (!post) return '';
  let s = String(post);
  if (/[?Ѐ-ӿ]/.test(s)) return ''; // Cyrillic / corrupted → drop
  s = s.toUpperCase().replace(/:/g, ' '); // "UY:4" → "UY 4"
  const m = s.match(/\b(RAYON|RAION|RN|R-N)\b/);
  if (m) s = s.slice(s.indexOf(m[0]) + m[0].length);
  else s = s.replace(/^.*?\bOBL(AST'?)?\b/, ''); // no rayon marker → strip a leading OBLAST chunk

  const out: string[] = [];
  for (const seg of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    // Drop country/region/city segments — they're authoritative from the structured fields. Covers the
    // no-RAYON cases (e.g. Karakalpakstan "RESPUBLIKA UZBEKISTAN, KARAKALPAKSTAN, GOROD NUKUS") and a
    // trailing city-repeat like "NAVOI SH." / "GOROD NAVOIY" (the shahri is already in the district).
    const segU = seg.toUpperCase();
    if (/\b(RESPUBLIKA|UZBEKISTAN|KARAKALPAKSTAN|OBLAST|GOROD|RAYON|RAION|SHAHRI|SHAHAR)\b/.test(segU)) continue;
    // "SH"/"SH." only as a TRAILING city-repeat marker (e.g. "NAVOI SH.") — not a
    // leading street initial like "SH. RUSTAVELI KUCHASI" (Shota Rustaveli st.).
    if (/\bSH\.?$/.test(segU.trim())) continue;
    const toks = seg.split(/\s+/).filter(Boolean);
    const parts: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!.replace(/[.]+$/, '').replace(/^[.]+/, '');
      const U = t.toUpperCase();
      if (!t) continue;
      if (U === 'UL' || U === 'GOROD') continue;
      if (NOISE.includes(U)) continue;
      if (MFY_TYPES.includes(U)) { parts.push('MFY'); continue; }
      if (MASSIV_TYPES.includes(U) || U.startsWith('MAVZE')) { parts.push('mavze'); continue; }
      if (KEEP_TYPES.includes(U)) { parts.push(U); continue; }
      if (U === 'KUCHA' || U === 'KUCHASI') { parts.push(`ko${g}chasi`); continue; }
      if (U === 'DAXASI' || U === 'DAHASI') { parts.push('dahasi'); continue; }
      if (U === 'DOM' || U === 'UY' || U === 'D') {
        // Trim only EDGE punctuation and keep an internal separator, so a composite house number
        // like "12/3" stays "12/3" instead of collapsing to a wrong single "123".
        const nx = toks[i + 1] ? toks[i + 1]!.replace(/^[^\dA-Za-z]+|[^\dA-Za-z]+$/g, '') : '';
        if (/^\d+(?:[\/-]\d+)*[A-Z]?$/.test(nx)) { parts.push(`${nx}-uy`); i++; }
        continue; // "UY R/S" etc. → no number → drop
      }
      if (U === 'KV' || U === 'KVARTIRA' || U === 'XONADON') {
        const nx = toks[i + 1] ? toks[i + 1]!.replace(/^[^\dA-Za-z]+|[^\dA-Za-z]+$/g, '') : '';
        if (/^\d+(?:[\/-]\d+)*[A-Z]?$/.test(nx)) { parts.push(`${nx}-xonadon`); i++; }
        continue;
      }
      const num = t.replace(/^[^\dA-Za-z]+|[^\dA-Za-z]+$/g, '');
      if (/^\d+(?:[\/-]\d+)*[A-Z]?$/.test(num)) { parts.push(num); continue; }
      parts.push(titleCase(t));
    }
    if (parts.length) out.push(parts.join(' '));
  }
  return out.filter((x, i) => x && x.toLowerCase() !== (out[i - 1] ?? '').toLowerCase()).join(', ');
}

/**
 * Full clean Uzbek Latin address: "Region, District, tail".
 * Region + district come from the structured fields (always correct when known); the tail is
 * best-effort from post_address. Returns '' only when nothing could be resolved.
 */
export function normalizeAddress(
  regionName: string | null | undefined,
  distrName: string | null | undefined,
  postAddress: string | null | undefined,
): string {
  return [mapRegion(regionName), mapDistrict(distrName), cleanTail(postAddress)].filter(Boolean).join(', ');
}
