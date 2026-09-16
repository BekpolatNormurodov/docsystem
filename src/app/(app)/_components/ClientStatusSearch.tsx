'use client';

// Reusable top-right "mijoz holati" qidiruvi — bir mijozni F.I.Sh yoki PINFL bo'yicha topib,
// uning HAR firmadagi ahvolini (qaysi bosqich/step + sud holati) bitta joyda ko'rsatadi.
// Mijozlar bo'limi VA Hisobot (/boss) bo'limida — ikkalasida ham ishlaydi.
// Ma'lumot: mavjud GET /konveyer/cases (konveyerPersons) — PINFL bo'yicha firmalararo birlashtirilgan.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { courtBadge } from '@/lib/court-result';
import { useT } from '@/lib/i18n/client';

interface PersonCase {
  firmId: number;
  firmName: string;
  stage: string;
  stageLabel: string;
  courtStatus?: string | null;
  courtStatusLabel?: string | null;
  courtResult?: string | null;
}
interface Person {
  pinfl: string;
  clientName: string | null;
  cases: PersonCase[];
  firmCount: number;
  totalDebt: string;
}

// Bosqich (phase) → yorliq + rang. konveyer.ts'dagi PHASES bilan bir xil (client-safe nusxa,
// CaseList.tsx ham xuddi shunday mahalliy xaritadan foydalanadi).
const PHASE_META: Record<string, { label: string; color: string }> = {
  PREP: { label: 'Tayyorlash', color: '#64748b' },
  SIGN: { label: 'Ariza · palata', color: '#8b5cf6' },
  BOJ: { label: 'Invoice', color: '#f59e0b' },
  COURT: { label: 'Sud', color: '#3b82f6' },
  EXEC: { label: 'Ijro', color: '#14b8a6' },
};
const STAGE_PHASE: Record<string, string> = {
  IMPORTED: 'PREP', TALABNOMA_SENT: 'PREP',
  ARIZA_GENERATED: 'SIGN', PRINTED: 'SIGN', CHAMBER_SENT: 'SIGN', CHAMBER_RETURNED: 'SIGN', SIGNED_SCANNED: 'SIGN',
  INVOICE_CREATED: 'BOJ', INVOICE_PAID: 'BOJ',
  COURT_SUBMITTED: 'COURT', COURT_ACCEPTED: 'COURT', COURT_RETURNED: 'COURT',
  MIB_SUBMITTED: 'EXEC', CLOSED: 'EXEC',
};
const phaseOf = (stage: string) => STAGE_PHASE[stage] ?? 'PREP';
// Bosqichlar tartibi (sidebardagi stepper bilan bir xil) — chipda «nechanchi/jami» ko'rsatish uchun.
const PHASE_ORDER = ['PREP', 'SIGN', 'BOJ', 'COURT', 'EXEC'];

const AVATAR = [
  'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  'bg-teal-500/15 text-teal-600 dark:text-teal-300',
  'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
];
const avatarColor = (seed: string) => AVATAR[[...(seed || '0')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
const initials = (name: string | null) => ((name || '—').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—');
// "BRIGHT FUTURE FINANCING" → "BRIGHT" — chip ixcham bo'lsin.
const firmShort = (name: string) => (name || '').trim().split(/\s+/)[0] || name;
const sum = (v: string) => Number(v || 0).toLocaleString('ru-RU');

export function ClientStatusSearch({ linkDate, placeholder, className }: { linkDate: string; placeholder?: string; className?: string }) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [persons, setPersons] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);

  useEffect(() => { const id = setTimeout(() => setDebouncedQ(q.trim()), 300); return () => clearTimeout(id); }, [q]);

  useEffect(() => {
    if (debouncedQ.length < 2) { setPersons([]); setTotal(0); setLoading(false); return; }
    const myReq = ++reqRef.current;
    setLoading(true);
    const ctrl = new AbortController();
    fetch(`/konveyer/cases?q=${encodeURIComponent(debouncedQ)}&pageSize=8`, { signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((data) => {
        if (myReq !== reqRef.current) return;
        setPersons(data.persons ?? []);
        setTotal(data.total ?? 0);
        setLoading(false);
      })
      .catch((e) => { if (e?.name === 'AbortError' || myReq !== reqRef.current) return; setPersons([]); setTotal(0); setLoading(false); });
    return () => ctrl.abort();
  }, [debouncedQ]);

  // Tashqariga bosilganda / Esc bosilganda yopish.
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  function goTo(pinfl: string) {
    setOpen(false);
    router.push(`/s/${linkDate}/p/${pinfl}`);
  }

  const showPanel = open && debouncedQ.length >= 2;

  return (
    <div ref={box} className={`relative w-full sm:w-[22rem] ${className ?? ''}`}>
      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          aria-label={t('Mijoz holati: F.I.Sh yoki PINFL')}
          placeholder={placeholder ?? t('Mijoz holati: F.I.Sh yoki PINFL…')}
          className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-9 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
        />
        {loading ? (
          <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
        ) : q ? (
          <button type="button" onClick={() => { setQ(''); setOpen(false); }} aria-label={t('Tozalash')}
            className="absolute right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">✕</button>
        ) : null}
      </div>

      {showPanel && (
        <div className="absolute right-0 z-40 mt-1.5 w-[min(30rem,90vw)] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          {loading && persons.length === 0 ? (
            <div className="space-y-2 p-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" />)}</div>
          ) : persons.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <div className="text-sm font-medium">«{debouncedQ}» {t('topilmadi')}</div>
              <div className="mt-1 text-xs text-muted">{t('Konveyerda (arizalar oqimida) bu mijoz yo‘q. Boshqa ism yoki PINFL bilan qidiring.')}</div>
            </div>
          ) : (
            <>
              <div className="max-h-[26rem] divide-y divide-line overflow-auto">
                {persons.map((p) => {
                  // Sud holati mijoz bo'yicha bitta (PINFL bo'yicha bog'langan) — yomon natijali (qaytgan/rad) ustun.
                  const court = p.cases.find((c) => c.courtStatus && courtBadge(c.courtStatus, c.courtStatusLabel, c.courtResult)?.bad)
                    ?? p.cases.find((c) => c.courtStatus);
                  const cb = court ? courtBadge(court.courtStatus, court.courtStatusLabel, court.courtResult) : null;
                  return (
                    <button key={p.pinfl} type="button" onClick={() => goTo(p.pinfl)}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2">
                      <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[13px] font-bold ${avatarColor(p.pinfl)}`} aria-hidden>{initials(p.clientName)}</span>
                      <div className="min-w-0 flex-1">
                        {/* To'liq F.I.Sh — uzun ismlar kesilmasin (truncate emas, satrga bo'linadi). */}
                        <div className="text-sm font-semibold leading-snug">{p.clientName || '—'}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] tabular-nums text-muted">{p.pinfl}</span>
                          {cb && <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cb.tone}`}>{cb.label}</span>}
                        </div>
                        {/* Har firma bo'yicha bosqich (step): «FIRMA · bosqich nomi · N/5».
                            Batafsil holat (masalan «Imzo / skan») tooltipda — chip ixcham qoladi. */}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {p.cases.map((c) => {
                            const ph = phaseOf(c.stage);
                            const meta = PHASE_META[ph];
                            const step = PHASE_ORDER.indexOf(ph) + 1;
                            return (
                              <span key={c.firmId} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]" title={`${c.firmName} · ${t(c.stageLabel)}`}>
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden />
                                <span className="font-semibold">{firmShort(c.firmName)}</span>
                                <span className="text-muted">· {t(meta.label)}</span>
                                <span className="tabular-nums text-muted/70">· {step}/{PHASE_ORDER.length}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <span className="mt-0.5 shrink-0 text-right text-xs font-bold tabular-nums">{sum(p.totalDebt)} <span className="font-normal text-muted">{t('so‘m')}</span></span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between border-t border-line bg-surface-2/40 px-3 py-1.5 text-[11px] text-muted">
                <span className="tabular-nums">{total.toLocaleString('ru-RU')} {t('mijoz topildi')}</span>
                {total > persons.length && <span>{t('aniqroq qidiring — hammasi ko‘rsatilmadi')}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
