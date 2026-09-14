import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';

// Bosh sahifa: odatda Hujjatlarga o'tadi. Faqat buxgalteriya ruxsatiga ega YURIST (Ulugbek) —
// Hujjatlar ko'rinmaydi, shuning uchun to'g'ridan-to'g'ri Buxgalteriyaga tushadi.
export default async function Home() {
  const user = await requireUser();
  // Admin default — Hisobot (/boss).
  if (user.role === 'ADMIN') redirect('/boss');
  const onlyBux = user.role === 'YURIST' && user.steps.length > 0 && user.steps.every((k) => k === 'buxgalteriya');
  redirect(onlyBux ? '/buxgalteriya' : '/hujjatlar');
}
