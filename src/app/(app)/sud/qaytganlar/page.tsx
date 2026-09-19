import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Sud → «Qaytganlar» endi /sud ichidagi 1-TAB (2026-09-19, 3 tabli /sud). Eski havolalar,
// xatcho'plar va landingHref (faqat sud:returns berilgan yurist) shu yerga keladi — ularni
// o'sha tabga yo'naltiramiz, ?s (snapshot) va ?firm saqlanadi. Ruxsat /sud sahifasida tab
// bo'yicha tekshiriladi (sud:returns).
export default function SudQaytganlarPage({ searchParams }: { searchParams: { s?: string; firm?: string } }) {
  const qs = new URLSearchParams({ tab: 'qaytgan' });
  if (searchParams.s) qs.set('s', searchParams.s);
  if (searchParams.firm) qs.set('firm', searchParams.firm);
  redirect(`/sud?${qs.toString()}`);
}
