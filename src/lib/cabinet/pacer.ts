// cabinetapi.sud.uz uchun GLOBAL tezlik chegaralagichi.
//
// NEGA kerak: 2026-09-06 da concurrency-6, kechikishsiz so'rovlar to'plami butun *.sud.uz
// domenini bir necha soatga blokladi (TCP ulanardi, TLS ClientHello'ga 0 bayt javob). Blok
// narxi — butun konveyerning to'xtashi — sekin ishlash narxidan ancha qimmat.
//
// MUHIM — nega "har firma uchun alohida navbat" YETARLI EMAS: sud.uz bizni firma bo'yicha
// emas, CHIQISH IP bo'yicha ko'radi (server: 213.230.64.140). 5 ta firma navbati parallel
// ishlasa, har biri "daqiqada 1 ta" bo'lsa ham, portalga daqiqada 5 ta case (~35 so'rov)
// uriladi. Shuning uchun navbatlar mantiqan alohida, lekin TEZLIK CHEGARASI global: bu
// modul butun jarayon bo'yicha bitta.
//
// Cheklov: chegara PROSESS ichida ishlaydi. Productionda joblar faqat worker konteynerida
// bajariladi (JOB_MODE=worker), ya'ni bitta jarayon — shuning uchun bu yetarli. Agar
// kelajakda bir nechta worker ko'tarilsa, chegara BAZAGA (masalan Setting yoki advisory
// lock) ko'chirilishi kerak.

/** Ikki HTTP so'rovi orasidagi eng kam vaqt. Bitta case ~7 so'rov => ~28s tarqaladi. */
export const REQUEST_GAP_MS = 4_000;

/**
 * Ikki case boshlanishi orasidagi ODATIY eng kam vaqt (daqiqada 1 ta). Haqiqiy qiymat
 * Court.sendIntervalSec dan olinadi (Sudlar bo'limidan sozlanadi) — bu faqat sud yozuvida
 * qiymat bo'lmaganda ishlatiladigan zaxira.
 */
export const CASE_GAP_MS = 60_000;

/** Sud yozuvidagi sozlamani millisekundga aylantiradi. Nosoz/bo'sh qiymatda — odatiy 60s.
 *  Pastki chegara 5s: tasodifan 0 yozib qo'yilsa portalga cheklovsiz urilib ketmasin. */
export function caseGapFor(sendIntervalSec?: number | null): number {
  if (!sendIntervalSec || !Number.isFinite(sendIntervalSec) || sendIntervalSec <= 0) return CASE_GAP_MS;
  return Math.max(5, Math.floor(sendIntervalSec)) * 1000;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Navbat zanjiri: har bir chaqiruv oldingisining tugashini kutadi, shuning uchun bir vaqtda
// faqat BITTA so'rov o'tadi (parallel firma navbatlari ham shu zanjirdan o'tadi).
let chain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;
let lastCaseAt = 0;

/**
 * Har bir cabinet HTTP so'rovidan OLDIN chaqiriladi. Oldingi so'rovdan REQUEST_GAP_MS
 * o'tmagan bo'lsa — kutadi. Chaqiruvlar navbat bo'ylab ketma-ket o'tadi.
 */
export function paceRequest(): Promise<void> {
  const next = chain.then(async () => {
    const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  // Zanjir hech qachon uzilmasin: bitta chaqiruvdagi xato keyingilarini bloklamasligi kerak.
  chain = next.catch(() => {});
  return next;
}

/**
 * Yangi case'ni boshlashdan OLDIN chaqiriladi. Oldingi case boshlanganidan CASE_GAP_MS
 * o'tmagan bo'lsa kutadi. `onWait` — operatorga "keyingi case N soniyadan keyin" deb
 * ko'rsatish uchun (progress qotib qolgandek ko'rinmasin).
 */
export async function paceCase(gapMs: number = CASE_GAP_MS, onWait?: (msLeft: number) => void): Promise<void> {
  const wait = lastCaseAt + gapMs - Date.now();
  if (wait > 0) {
    onWait?.(wait);
    await sleep(wait);
  }
  lastCaseAt = Date.now();
}

/** Blok/429 dan keyin butun navbatni sovutish — keyingi so'rov shu muddatdan oldin ketmaydi. */
export function backoff(ms: number): void {
  const until = Date.now() + ms;
  if (until > lastRequestAt + REQUEST_GAP_MS) lastRequestAt = until - REQUEST_GAP_MS;
  if (until > lastCaseAt + CASE_GAP_MS) lastCaseAt = until - CASE_GAP_MS;
}
