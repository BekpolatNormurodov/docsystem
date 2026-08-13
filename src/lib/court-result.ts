// Court (cabinet.sud.uz) case status + RESULT → a single Uzbek badge (label + tone). The bug this
// fixes: the badge tone was keyed on `status` alone, so a FINISHED case whose RESULT is RETURNED
// showed GREEN «Yakunlangan · RETURNED» — reading as a success when the court actually RETURNED the
// ariza (a failure that needs re-filing). A «bad» result now overrides the status tone (rose) and
// becomes the headline. Pure + client-safe (no prisma/server imports).

export const COURT_STATUS_UZ: Record<string, string> = {
  DRAFT: 'Qoralama', CREATED: 'Yaratilgan', PENDING: 'Kutilmoqda',
  IN_PROCESS: 'Koʻrib chiqilmoqda', DECIDED: 'Qaror chiqarilgan',
  FINISHED: 'Yakunlangan', DECLINED: 'Rad etilgan', RETURNED: 'Qaytarilgan',
};

// cabinet `case_result` codes (the OUTCOME, separate from status).
export const COURT_RESULT_UZ: Record<string, string> = {
  FULFILLED: 'Qanoatlantirilgan',
  PARTIALLY_FULFILLED: 'Qisman qanoatlantirilgan',
  RETURNED: 'Ariza qaytarilgan',
  REFUSED: 'Rad etilgan',
  UNCONSIDERED: 'Koʻrib oʻtirilmagan',
  WITHDRAWN: 'Qaytarib olingan',
};

// A «bad» result means the ariza did NOT go through — it must be fixed and re-filed.
export const BAD_RESULTS = new Set(['RETURNED', 'REFUSED', 'UNCONSIDERED', 'WITHDRAWN']);
export const GOOD_RESULTS = new Set(['FULFILLED', 'PARTIALLY_FULFILLED']);

// Per-result colour + plain-language «asosiy sabab» (what it means) + tavsiya (next action).
// The EXACT per-case wording lives only in the ajrim PDF on cabinet.sud.uz (the API does not
// expose it), so this is the standard meaning of each outcome — shown when a return row is opened.
// chip = inactive (light tint) · chipActive = active/selected (solid fill) — literal Tailwind
// class strings (JIT can't see interpolated names), so both variants are spelled out per result.
export interface ReturnResultInfo { label: string; chip: string; chipActive: string; dot: string; what: string; action: string }
export const RETURN_RESULT_INFO: Record<string, ReturnResultInfo> = {
  RETURNED: {
    label: 'Ariza qaytarilgan',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    chipActive: 'bg-amber-500 text-white shadow-sm',
    dot: 'bg-amber-500',
    what: 'Ariza protsessual kamchilik sababli qaytarilgan — odatda hujjat yetishmovchiligi, ariza noto‘g‘ri/to‘liqsiz to‘ldirilgani, davlat boji yoki sudlovga taalluqlilik masalasi.',
    action: 'Ajrimda ko‘rsatilgan kamchilik tuzatilib, ariza cabinet.sud.uz orqali qayta topshiriladi.',
  },
  REFUSED: {
    label: 'Rad etilgan',
    chip: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    chipActive: 'bg-rose-500 text-white shadow-sm',
    dot: 'bg-rose-500',
    what: 'Sud arizani qabul qilishni rad etgan — masalan nizo bu sudga taalluqli emas yoki qonuniy asos mavjud emas.',
    action: 'Ajrim bilan tanishib, tegishli sud/tartibda yoki asoslarni to‘ldirgan holda murojaat qilinadi.',
  },
  UNCONSIDERED: {
    label: 'Ko‘rib o‘tirilmagan',
    chip: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    chipActive: 'bg-violet-500 text-white shadow-sm',
    dot: 'bg-violet-500',
    what: 'Ariza ko‘rilmasdan qoldirilgan — protsessual asoslar (ariza talablariga to‘liq javob bermagani yoki taraf harakatsizligi).',
    action: 'Ko‘rsatilgan sabab bartaraf etilib, ariza qayta beriladi.',
  },
  WITHDRAWN: {
    label: 'Qaytarib olingan',
    chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    chipActive: 'bg-slate-500 text-white shadow-sm',
    dot: 'bg-slate-500',
    what: 'Ariza undiruvchi (arizachi) tomonidan qaytarib olingan.',
    action: 'Zarurat bo‘lsa qayta tayyorlab topshiriladi.',
  },
};
export const returnResultInfo = (code?: string | null): ReturnResultInfo =>
  RETURN_RESULT_INFO[code ?? ''] ?? {
    label: COURT_RESULT_UZ[code ?? ''] ?? code ?? 'Nomaʼlum',
    chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    chipActive: 'bg-slate-500 text-white shadow-sm', dot: 'bg-slate-400',
    what: 'Sud arizani qaytargan/rad etgan.', action: 'Ajrim bilan tanishib, kamchilik tuzatiladi.',
  };

const TONE_GOOD = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
const TONE_BAD = 'bg-rose-500/15 text-rose-600 dark:text-rose-300';
const TONE_WARN = 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
const TONE_NEUTRAL = 'bg-slate-500/15 text-slate-600 dark:text-slate-300';

const STATUS_TONE: Record<string, string> = {
  DECIDED: TONE_GOOD, FINISHED: TONE_GOOD,
  IN_PROCESS: TONE_WARN, PENDING: TONE_WARN,
  CREATED: TONE_NEUTRAL, DRAFT: TONE_NEUTRAL,
  RETURNED: TONE_BAD, DECLINED: TONE_BAD,
};

export const courtResultLabel = (result?: string | null): string | null =>
  result ? (COURT_RESULT_UZ[result] ?? result) : null;

/**
 * One badge for a court case. `bad` result → rose tone + the result IS the headline («Ariza
 * qaytarilgan»); a good/neutral result → status label, with the result appended after «·».
 */
export function courtBadge(
  status?: string | null,
  statusLabel?: string | null,
  result?: string | null,
): { label: string; tone: string; bad: boolean } | null {
  if (!status && !statusLabel) return null;
  const sLabel = statusLabel || COURT_STATUS_UZ[status ?? ''] || status || '';
  const rLabel = courtResultLabel(result);
  const bad = !!result && BAD_RESULTS.has(result);
  const good = !!result && GOOD_RESULTS.has(result);
  const tone = bad ? TONE_BAD : good ? TONE_GOOD : (status && STATUS_TONE[status]) || TONE_NEUTRAL;
  // Returned/refused: the outcome is what matters, not «Yakunlangan». Else status (+ result).
  const label = bad ? (rLabel ?? sLabel) : rLabel ? `${sLabel} · ${rLabel}` : sLabel;
  return { label, tone, bad };
}
