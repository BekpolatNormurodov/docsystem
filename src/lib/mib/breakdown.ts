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

// Regionni MIB bo'limi / sud organi matnidan aniqlaymiz (kirill + lotin). Toshkent SHAHRI
// «Toshkent» dan OLDIN tekshiriladi — aks holda hammasi «viloyat»ga tushib qoladi.
export const REGION_TOKENS: [RegExp, string][] = [
  [/қорақалпоғ|qoraqalpog|karakalpak/i, 'Qoraqalpogʻiston'],
  [/андижон|andijon/i, 'Andijon'],
  [/бухоро|buxoro|bukhara/i, 'Buxoro'],
  [/жиззах|jizzax/i, 'Jizzax'],
  [/қашқадарё|qashqadaryo|kashkadar/i, 'Qashqadaryo'],
  [/навоий|navoiy/i, 'Navoiy'],
  [/наманган|namangan/i, 'Namangan'],
  [/самарқанд|samarqand|samarkand/i, 'Samarqand'],
  [/сурхондарё|surxondaryo|surkhandar/i, 'Surxondaryo'],
  [/сирдарё|sirdaryo|syrdar/i, 'Sirdaryo'],
  [/фарғона|fargʻona|fargona|fergana/i, 'Fargʻona'],
  [/хоразм|xorazm|khorezm/i, 'Xorazm'],
  [/тошкент\s*шаҳ|toshkent\s*shah|tashkent\s*city/i, 'Toshkent shahri'],
  [/тошкент|toshkent|tashkent/i, 'Toshkent viloyati'],
];
export function regionFromText(t: string): string | null {
  for (const [re, name] of REGION_TOKENS) if (re.test(t)) return name;
  return null;
}
/** Mijoz regioni: Excel «region» bo'lsa o'sha, aks holda ijrochi bo'limi / sud organidan aniqlanadi. */
export function regionOf(c: BClient): string | null {
  const r = clean(c.region);
  if (r) return r;
  for (const k of c.cases) {
    const m = regionFromText(`${k.executorDept ?? ''} ${k.courtOrgan ?? ''}`);
    if (m) return m;
  }
  return null;
}

const UNKNOWN = 'Aniqlanmagan';
export function rowKey(c: BClient, k: BCase, dim: Dim): string {
  if (dim === 'firma') return k.firmName ? shortFirm(k.firmName) : 'Boshqa kreditorlar';
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
      const r = rows.get(key) ?? { label: key, cases: 0, clients: new Set<number>(), ours: 0, debt: 0 };
      r.cases += 1; r.clients.add(c.id); if (k.isTargetFirm) r.ours += 1; r.debt += parseMoney(k.remainingDebt);
      rows.set(key, r);
    }
  }
  return [...rows.values()]
    .map((r) => ({ label: r.label, cases: r.cases, clients: r.clients.size, ours: r.ours, debt: r.debt }))
    .sort((a, b) => b.cases - a.cases || b.debt - a.debt);
}
