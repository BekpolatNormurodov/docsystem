// PUZZY (fuzzy) qidiruv — ismlarda ~70% o'xshash bo'lsa topadi, PINFL/raqamlarda ANIQ moslik.
//
// NEGA: ilgari hamma joyda `String.includes` edi — «ISMOILV» yozgan operator «ISMOILOV»
// mijozini topmasdi. PINFL 14 raqamli identifikator, bir raqamlik xato boshqa odamga olib
// keladi — shuning uchun raqamli so'rov aynan raqam ichida bo'lishi shart.
//
// Ism uchun Sørensen-Dice koeffitsiyenti (bigram bo'yicha): tez, matritsa yo'q, so'z tartibiga
// bog'liq emas (tokenlar bo'yicha). Sinovlar bilan tasdiqlangan:
//   ISMOILV ↔ ISMOILOV = 0.86   (bitta yo'qolgan harf — topiladi)
//   KARIMOV ↔ KAREMOV  = 0.71   (bitta xato — topiladi)
//   KARIM   ↔ KAREM    = 0.66   (chegaraga yaqin, chegara 0.70)
//   ISLAM   ↔ ISMAT    = 0.20   (butunlay boshqa — topilmaydi)
//
// Chegara 0.70 — foydalanuvchi tanlovi. Ko'p tokenli so'rov (masalan «ismoilov karim») da
// har token o'z eng yaxshi mos tokenini topadi, o'rtachasi 0.70 dan yuqori bo'lishi kerak.
import { normName } from '../core/norm-name';

export const DEFAULT_THRESHOLD = 0.70;

/** So'rov faqat raqamlardan iboratmi (probel/tinish belgilaridan tozalangach). PINFL sifatida
 *  qaraladi va faqat pinfl maydoniga aniq (contains) moslashtiriladi. */
export function isDigitQuery(q: string): boolean {
  const d = String(q ?? '').replace(/\D/g, '');
  return d.length >= 3 && !/[a-zа-я]/i.test(String(q ?? ''));
}

/** Bir necha ismli funksiyalar uchun raqamlarni ajratib olish. */
export const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

function bigramCounts(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) {
    const b = s.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

/** Dice koeffitsiyenti (0..1) — bigram bo'yicha. Simmetrik. */
export function diceRatio(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigramCounts(a);
  const B = bigramCounts(b);
  let total = 0, common = 0;
  for (const n of A.values()) total += n;
  for (const [k, nb] of B) {
    total += nb;
    const na = A.get(k);
    if (na) common += Math.min(na, nb);
  }
  return total ? (2 * common) / total : 0;
}

/** Ikki ism o'rtasidagi eng yaxshi ball (tokenlar bo'yicha, so'z tartibiga bog'liq emas).
 *  Har query tokeni eng yaxshi mos keladigan target tokenini topadi; natija o'rtachasi qaytariladi. */
export function fuzzyNameScore(target: string, query: string): number {
  const t = normName(target);
  const q = normName(query);
  if (!t || !q) return 0;
  if (t === q) return 1;
  if (t.includes(q) || q.includes(t)) return 1; // aniq qism — 1
  const ts = t.split(' ').filter((x) => x.length >= 2);
  const qs = q.split(' ').filter((x) => x.length >= 2);
  if (!ts.length || !qs.length) return 0;
  if (qs.length === 1) {
    let best = 0;
    for (const x of ts) best = Math.max(best, diceRatio(qs[0], x));
    return best;
  }
  let sum = 0;
  for (const qt of qs) {
    let best = 0;
    for (const tt of ts) best = Math.max(best, diceRatio(qt, tt));
    sum += best;
  }
  return sum / qs.length;
}

export interface FuzzyTarget {
  /** Ism (mijoz F.I.O yoki firma nomi). Fuzzy — ~70% o'xshashlik. */
  name?: string | null;
  /** PINFL/JSHSHIR — faqat raqamli so'rovga aniq (contains) moslik. */
  pinfl?: string | null;
  /** Qo'shimcha matn maydonlari (ish raqami, sud nomi, kod...) — oddiy substring. */
  extras?: (string | null | undefined)[];
}

/**
 * Puzzy moslik. Qoidalar:
 *   • So'rov raqamli (masalan «5280308») → faqat `pinfl` ga ANIQ contains.
 *   • So'rov ismli → `name` ga Dice fuzzy (chegara `threshold`, sukut 0.70).
 *     Substring yoki tokenlar bo'yicha aniq moslik esa har doim o'tadi (ball 1).
 *   • `extras` — oddiy lowercase substring (ish raqami, sud nomi kabi identifikatorlar).
 *   • Bo'sh so'rov → true (filtr yo'q).
 */
export function matchesFuzzy(t: FuzzyTarget, q: string, opts: { threshold?: number } = {}): boolean {
  const raw = String(q ?? '').trim();
  if (!raw) return true;
  const th = opts.threshold ?? DEFAULT_THRESHOLD;

  // Extras — arzon, birinchi tekshiramiz (ish raqami/sud nomi ismga hech qachon fuzzy mos kelmasin).
  if (t.extras?.length) {
    const low = raw.toLowerCase();
    for (const e of t.extras) if (e && String(e).toLowerCase().includes(low)) return true;
  }

  if (isDigitQuery(raw)) {
    const d = onlyDigits(raw);
    return !!t.pinfl && onlyDigits(t.pinfl).includes(d);
  }
  return fuzzyNameScore(t.name ?? '', raw) >= th;
}

/**
 * Backend uchun: fuzzy so'rovni Prisma OR-contains prefiltriga aylantiradi (SQL bosqichi keng
 * nomzod to'plamini oladi, JS keyin `matchesFuzzy` bilan aniq baholaydi). Raqamli so'rov → pinfl,
 * ismli so'rov → har 3+ harfli token har bir matn maydoniga contains bilan OR qilinadi.
 *
 * `fields` — qidiriladigan matn ustunlari (masalan clientName, kod). PINFL alohida `pinflField`
 * bilan uzatiladi — SQL bosqichida u faqat raqamli so'rovga kiradi.
 */
export function fuzzyPrismaOr(q: string, fields: string[], pinflField = 'pinfl'): Record<string, unknown> | undefined {
  const raw = String(q ?? '').trim();
  if (!raw) return undefined;
  if (isDigitQuery(raw)) return { [pinflField]: { contains: onlyDigits(raw) } };
  const norm = normName(raw);
  const tokens = [...new Set(norm.split(' ').filter((t) => t.length >= 3))];
  const seeds = tokens.length ? tokens : [norm].filter((x) => x.length >= 3);
  if (!seeds.length) return { OR: fields.map((f) => ({ [f]: { contains: raw } })) };
  const or: unknown[] = [];
  for (const s of seeds) for (const f of fields) or.push({ [f]: { contains: s } });
  return { OR: or };
}
