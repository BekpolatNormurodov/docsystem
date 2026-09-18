'use client';

// «Oxirgi yangilanish» — header chap tepasida (sahifa sarlavhasidan keyin). Worker sud (ADOLAT) va
// talabnoma (hippo) holatlarini avtomat yangilaganda Setting'ga ISO vaqt yozadi (court_status_refreshed_at
// / talabnoma_refreshed_at); layout shu ikkisini o'qib bu yerga uzatadi. Eng so'nggi vaqtни «N daq oldin»
// ko'rinishida ko'rsatadi, tooltipda sud + talabnoma alohida. Nisbiy vaqt FAQAT mount'dan keyin
// hisoblanadi — server/mijoz orasida hydration nomuvofiqligi bo'lmasin (avval mutlaq HH:MM turadi).
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';

const fmtAbs = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch { return ''; }
};

export function HeaderRefreshBadge({ court, talabnoma }: { court?: string | null; talabnoma?: string | null }) {
  const t = useT();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const times = [court, talabnoma].filter(Boolean) as string[];
  if (times.length === 0) return null; // hali hech qachon sinxron bo'lmagan — hech narsa ko'rsatmaymiz
  const latest = times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));

  // Nisbiy yorliq — mount'dan keyin (now != null). Undan oldin mutlaq HH:MM (barqaror, mismatch yo'q).
  let rel = fmtAbs(latest);
  if (now != null) {
    const m = Math.max(0, Math.round((now - new Date(latest).getTime()) / 60_000));
    rel = m < 1 ? t('hozirgina')
      : m < 60 ? `${m} ${t('daq oldin')}`
      : m < 60 * 24 ? `${Math.round(m / 60)} ${t('soat oldin')}`
      : fmtAbs(latest);
  }

  const tip = [
    `${t('Oxirgi yangilanish')}`,
    court ? `${t('Sud')}: ${fmtAbs(court)}` : null,
    talabnoma ? `${t('Talabnoma')}: ${fmtAbs(talabnoma)}` : null,
  ].filter(Boolean).join('\n');

  return (
    <span title={tip} className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] leading-none text-muted sm:inline-flex">
      <svg className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </svg>
      <span className="hidden text-muted md:inline">{t('Yangilangan')}:</span>
      <span className="font-semibold tabular-nums text-fg">{rel}</span>
    </span>
  );
}
