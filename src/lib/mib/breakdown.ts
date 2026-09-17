// MIB monitoring — kesim (group-by) va region aniqlash MANTIQI. Bir joyda, chunki uni HAM
// mijoz-tomon dashboard (MibDashboard.tsx), HAM server Excel (excel.ts) ishlatadi — ikki nusxa
// bo'lmasligi uchun. Faqat sof funksiyalar (React ham, Prisma import ham yo'q) — struktura tipi
// bilan ishlaydi, shuning uchun mijoz JSON'i ham, Prisma yozuvi ham to'g'ri keladi.

export interface BCase {
  executorDept: string | null;
  bankName: string | null;
  courtOrgan: string | null;
  firmName: string | null;
  isTargetFirm: boolean;
  remainingDebt: string | null;
}
export interface BClient {
  id: number;
  region: string | null;
  cases: BCase[];
}

export type Dim = 'firma' | 'region' | 'hudud' | 'bank';
export interface BRow { label: string; cases: number; clients: number; ours: number; debt: number }

export const parseMoney = (s: string | null | undefined): number => {
  if (!s) return 0;
  const v = Number(String(s).replace(/[^\d.,-]/g, '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};
export const clean = (s: string | null | undefined): string => (s && s !== 'Nomaʼlum' ? s.trim() : '');
export const shortFirm = (s: string): string => s.replace(/ MIKROMOLIYA.*$/i, '').replace(/["«»]/g, '').trim();

// Bank nomini FILIALSIZ bazaga keltiradi — «АТБ "Bank" Xorazm filiali» va «... Toshkent viloyat
// filiali» BITTA bank sifatida guruhlansin (aks holda bir bank 4-5 xil ko'rinadi).
export function normalizeBank(s: string | null | undefined): string {
  const t = clean(s);
  if (!t) return '';
  const q = t.match(/^(.*?[«"“][^«"”»]+[»"”])/); // qo'shtirnoq ichidagi bank nomigacha
  if (q) return q[1].replace(/\s+/g, ' ').trim();
  // Qo'shtirnoqsiz — oxiridagi «<viloyat> filiali» ni olib tashlaymiz (Cyrillic uchun \S ishlatamiz).
  return t.replace(/\s+\S+\s+(?:минтақавий\s+)?(?:филиал\S*|filial\S*)\s*$/iu, '').replace(/\s+/g, ' ').trim() || t;
}

// Regionni MIB bo'limi / sud organi / portfel manzilidan aniqlaymiz. UCH yozuv turini QAMRAB oladi:
// (1) o'zbek KIRILL, (2) LOTIN, (3) RUS KIRILL — chunki mib.uz/ADOLAT/portfel matni uch tilda ham
// kelishi mumkin (masalan RU «Ташкентская область», «Ферганская», «Бухарская»: RU «а» ≠ UZ «о»,
// «к» ≠ «қ», shuning uchun alohida yozamiz). Toshkent SHAHRI «Toshkent»dan OLDIN tekshiriladi.
// Ba'zi tumanlar viloyatga yig'iladi (Uchtepa → Toshkent shahri, Yuqorichirchiq → Toshkent viloyati).
export const REGION_TOKENS: [RegExp, string][] = [
  [/қорақалпоғ|qoraqalpog|karakalpak|каракалпак|қорақалпак|нукус|nukus/i, 'Qoraqalpogʻiston'],
  [/андижон|andijon|андижан/i, 'Andijon'],
  [/бухоро|buxoro|bukhara|бухар/i, 'Buxoro'],
  [/жиззах|jizzax|джизак/i, 'Jizzax'],
  [/қашқадарё|qashqadaryo|kashkadar|кашкадар/i, 'Qashqadaryo'],
  [/навоий|navoiy|навои/i, 'Navoiy'],
  [/наманган|namangan/i, 'Namangan'],
  [/самарқанд|samarqand|samarkand|самарканд/i, 'Samarqand'],
  [/сурхондарё|surxondaryo|surkhandar|сурхандар|термиз|termiz|денов|denov/i, 'Surxondaryo'],
  [/сирдарё|sirdaryo|syrdar|сырдар/i, 'Sirdaryo'],
  [/фарғона|fargʻona|fargona|fergana|фергана/i, 'Fargʻona'],
  [/хоразм|xorazm|khorezm|хорезм/i, 'Xorazm'],
  // Tumanlar → viloyat (misol tariqasida foydalanuvchi so'ragan ikkisi). Generik «toshkent»dan OLDIN.
  [/учтепа|uchtepa/i, 'Toshkent shahri'],
  [/юқоричирчиқ|yuqorichirchiq|верхнечирчик/i, 'Toshkent viloyati'],
  // «Тошкент шаҳар» — portfelda «х» (U+0445) bilan: «шах», shuning uchun ша[ҳх].
  [/тошкент\s*ша[ҳх]|toshkent\s*shah|tashkent\s*city|город\s*ташкент|ташкент\s*г/i, 'Toshkent shahri'],
  // «Тош обл» = Toshkent viloyati qisqartmasi.
  [/тош\s*обл|тошкент\s*вил|тошкент|toshkent|tashkent|ташкент/i, 'Toshkent viloyati'],
];

// TUMAN → VILOYAT. MIB `executorDept` ko'pincha faqat «<Tuman> тумани» bo'ladi (viloyat yozilmaydi),
// courtOrgan esa ko'p ish uchun MARKAZIY «Учтепа туманлараро суди» (Toshkent) — shuning uchun tumandan
// aniqlamasak, region NOTO'G'RI Toshkent'ga tegib ketardi (2026-09-17). Ushbu xarita executorDept'dagi
// tumanni to'g'ri viloyatiga bog'laydi. Faqat KIRILL (mib.uz shu tilda beradi); ehtiyot uchun ba'zi
// lotin variantlar ham. «тумани»/«шаҳри» qo'shimchasidan oldingi o'zakka mos keladi.
// Diqqat: JS `\b` faqat ASCII harflar uchun ishlaydi — KIRILL harf yonida noto'g'ri; shuning uchun
// tuman o'zaklariga «\b» qo'yilmaydi, o'zak yetarlicha farqlovchi (kerak bo'lsa «\s*тум»/«шаҳ» bilan).
export const DISTRICT_TOKENS: [RegExp, string][] = [
  // Andijon
  [/асака|балиқчи|жалақудуқ|избоскан|марҳамат|олтинкўл|пахтаобод|хўжаобод|шаҳрихон|қўрғонтепа|улуғнор|хонобод/i, 'Andijon'],
  // Fargʻona
  [/қўқон|марғилон|фурқат|қувасой|қува\s|учкўприк|учкуприк|данғара|риштон|ўзбекистон\s*тум|олтиариқ|қўштепа|бешариқ|бувайда|боғдод|тошлоқ|сўх|ёз[ъ]?ёвон|қувадарё/i, 'Fargʻona'],
  // Namangan
  [/косонсой|учқўрғон|учкурган|поп\s*тум|чуст|мингбулоқ|норин|тўрақўрғон|уйчи|чортоқ|янгиқўрғон|давлатобод/i, 'Namangan'],
  // Samarqand
  [/қўшрабод|пайариқ|оқдарё|пахтачи|тайлоқ|жомбой|каттақўрғон|иштихон|нарпай|нуробод|пастдарғом|ургут|булунғур|қўшработ/i, 'Samarqand'],
  // Buxoro
  [/жондор|шофиркон|когон|ғиждувон|вобкент|қоракўл|олот\s*тум|пешку|ромитан|қоровулбозор/i, 'Buxoro'],
  // Sirdaryo
  [/ховос|оқолтин|сайҳунобод|сайхунобод|гулистон|янгиер|мирзаобод|боёвут|сардоба|ширин\s*шаҳ/i, 'Sirdaryo'],
  // Surxondaryo
  [/узун\s*тум|бойсун|жарқўрғон|қумқўрғон|сариосиё|шеробод|ангор|бандихон|музработ|олтинсой|шўрчи|қизириқ|учқизил/i, 'Surxondaryo'],
  // Qashqadaryo
  [/қарши|яккабоғ|ғузор|деҳқонобод|косон\s*тум|китоб|миришкор|муборак|нишон|чироқчи|шаҳрисабз|касби|қамаши|камаши/i, 'Qashqadaryo'],
  // Xorazm
  [/хазорасп|хива|боғот|гурлан|қўшкўпир|урганч|хонқа|шовот|янгиариқ|янгибозор|питнак|тупроққалъа/i, 'Xorazm'],
  // Navoiy
  [/зарафшон|қизилтепа|навбаҳор|учқудуқ|кармана|конимех|нурота|томди|хатирчи|ғозғон|ғозгон/i, 'Navoiy'],
  // Jizzax
  [/пахтакор|арнасой|бахмал|дўстлик|зарбдор|зафаробод|мирзачўл|форими|ғаллаорол|шароф\s*рашидов|янгиобод|уста\s*ирисов|зомин|балиқли/i, 'Jizzax'],
  // Toshkent viloyati (tumanlar)
  [/бўстонлиқ|оҳангарон|ўртачирчиқ|оққўрғон|чирчиқ|чиноз|бўка\s*тум|ангрен|бекобод|зангиота|қибрай|қуйичирчиқ|паркент|пискент|янгийўл|нурафшон|олмалиқ|тошкент\s*тум/i, 'Toshkent viloyati'],
  // Toshkent shahri (tumanlar) — Янгиҳаёт yangi tuman
  [/сергели|юнусобод|чилонзор|олмазор|мирзо\s*улуғбек|миробод|яккасарой|яшнобод|бектемир|шайхонтоҳур|сирғали|янгиҳаёт|янгихаёт/i, 'Toshkent shahri'],
  // Qoraqalpogʻiston
  [/амударё|хўжайли|тўрткўл|кегейли|беруний|қонликўл|қораўзак|мойноқ|тахтакўпир|чимбой|шуман[ао]й|элликқалъа|бўзатоў|бўстон\s*тум|қўнғирот|нукус/i, 'Qoraqalpogʻiston'],
];

export function regionFromText(t: string): string | null {
  for (const [re, name] of REGION_TOKENS) if (re.test(t)) return name;
  for (const [re, name] of DISTRICT_TOKENS) if (re.test(t)) return name;
  return null;
}
/** Mijoz regioni: Excel «region» bo'lsa o'sha; aks holda AVVAL ijrochi bo'limi (executorDept — qarzdorning
 *  haqiqiy tumani), so'ng sud organidan aniqlanadi. Ijrochi bo'limi USTUN — chunki courtOrgan ko'p ish
 *  uchun markaziy «Учтепа» sudi bo'lib, region'ни noto'g'ri Toshkent'ga tortardi. */
export function regionOf(c: BClient): string | null {
  const r = clean(c.region);
  if (r) return r;
  for (const k of c.cases) { const m = regionFromText(k.executorDept ?? ''); if (m) return m; }
  for (const k of c.cases) { const m = regionFromText(k.courtOrgan ?? ''); if (m) return m; }
  return null;
}

export const UNKNOWN = 'Aniqlanmagan';
export const OTHER_FIRM = 'Boshqa kreditorlar';
export function rowKey(c: BClient, k: BCase, dim: Dim): string {
  if (dim === 'firma') return k.firmName ? shortFirm(k.firmName) : OTHER_FIRM;
  if (dim === 'region') return regionOf(c) ?? UNKNOWN;
  if (dim === 'hudud') return clean(k.executorDept) || UNKNOWN;
  return normalizeBank(k.bankName) || UNKNOWN;
}

/** Case-daraja group-by: har guruh uchun ijro ishi, bizniki, alohida mijoz, qoldiq qarz yig'indisi. */
export function groupBreakdown(clients: BClient[], dim: Dim): BRow[] {
  const rows = new Map<string, { label: string; cases: number; clients: Set<number>; ours: number; debt: number }>();
  for (const c of clients) {
    for (const k of c.cases) {
      const key = rowKey(c, k, dim);
      // Region/Hudud/Bank — bu kesimlar IJRO-DETALIga tayanadi (ijrochi bo'limi, banki), u esa faqat
      // biz chuqur tortgan (bizniki) ishlarда bor. Detalsiz boshqa-kreditor ishlari (Davlat/bank —
      // ro'yxatning ~yarmi) bu maydonларда bo'sh → «Aniqlanmagan» bo'lardi va kesimni ko'mib tashlardi.
      // Ularni bu 3 kesimда SANAMAYMIZ (2026-09-17). «Firma» kesimи esa hammasini ko'rsatadi
      // («Boshqa kreditorlar» sifatida) — u detalsiz ham ma'noli.
      if (key === UNKNOWN && dim !== 'firma') continue;
      const r = rows.get(key) ?? { label: key, cases: 0, clients: new Set<number>(), ours: 0, debt: 0 };
      r.cases += 1; r.clients.add(c.id); if (k.isTargetFirm) r.ours += 1; r.debt += parseMoney(k.remainingDebt);
      rows.set(key, r);
    }
  }
  return [...rows.values()]
    .map((r) => ({ label: r.label, cases: r.cases, clients: r.clients.size, ours: r.ours, debt: r.debt }))
    .sort((a, b) => b.cases - a.cases || b.debt - a.debt);
}
