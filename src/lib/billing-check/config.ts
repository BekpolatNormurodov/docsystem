// «Bizning summalarimiz» — qaysi summadagi kvitansiya biz yaratganimiz hisoblanadi.
// Qolganlari «ortiqcha»: summa xato kiritilgan yoki sud qo'shimcha qo'ygan bo'ladi va
// odatda bekor qilinadi.
//
// Ro'yxat Setting jadvalida saqlanadi — deploysiz o'zgartirish mumkin (operator UI dan
// tanlaydi). Qiymatlar TIYINDA (billing shunday qaytaradi): 2 060 000 = 20 600 so'm.
import { prisma } from '@/lib/db';
import { DEFAULT_OWN_AMOUNTS_TIYIN } from './filters';

// Bu fayl prisma'ni import qiladi → FAQAT serverda. Sof `isOwn` va default ro'yxat
// filters.ts da (klient komponenti ham o'shani import qiladi).
export { DEFAULT_OWN_AMOUNTS_TIYIN, isOwn } from './filters';

const KEY = 'billingCheck.ownAmounts';

export async function getOwnAmounts(): Promise<number[]> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row?.value) return DEFAULT_OWN_AMOUNTS_TIYIN;
  const list = row.value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  // Bo'sh ro'yxat saqlangan bo'lsa ham defaultga qaytmaymiz: operator ataylab
  // «hech biri bizniki emas» deb qo'ygan bo'lishi mumkin.
  return row.value.trim() === '' ? [] : list;
}

export async function setOwnAmounts(list: number[]): Promise<number[]> {
  const clean = [...new Set(list.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  const value = clean.join(',');
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return clean;
}
