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

import { prisma } from '../db';

/**
 * Ikki HTTP so'rovi orasidagi eng kam vaqt — HAQIQIY cheklovchi.
 *
 * Bitta ish 15 ta hujjat bilan ~23 so'rov qiladi (sessiya, qoralama, 2×PUT, 15 yuklash,
 * kvitansiya, save-suit, send-to-court). 4 soniyada bu 92 soniya bo'ladi, ya'ni sud
 * sozlamasidagi 45s interval hech qachon qo'llanmaydi — u allaqachon o'tib bo'lgan.
 * Tezlikni oshirish uchun aynan SHU qiymatni pasaytirish kerak.
 *
 * TEZLASHTIRISH SINALDI VA MUVAFFAQIYATSIZ TUGADI (2026-09-07):
 *   4 soniyada  06:22-06:38  →  12 ta ketdi, 0 xato
 *   2 soniyada  06:39-06:44  →   0 ta ketdi, 9 ta xato
 * 2 soniyada portal ~13 daqiqadan keyin hamma narsani rad eta boshladi: hatto eng yengil
 * `user/get` ham 500 berdi va TLS uzilishlari boshlandi — 2026-09-06 dagi 6 soatlik
 * blokning aynan o'sha belgilari. Shuning uchun 4 soniyaga qaytarildi.
 *
 * Tezlashtirmoqchi bo'lsangiz: KICHIK qadam bilan (masalan 3s), kichik partiyada sinang va
 * xatolar paydo bo'lishini kuzating. Portal chidamini bilmaymiz — 4s tekshirilgan yagona
 * xavfsiz qiymat.
 */
export const REQUEST_GAP_MS = Math.max(1_000, Number(process.env.CABINET_REQUEST_GAP_MS) || 4_000);

/**
 * FAYL YUKLASH uchun alohida, qisqaroq interval.
 *
 * Nega ajratildi: bitta ishda 15-17 ta hujjat bo'ladi va ular butun vaqtning katta qismini
 * yeydi (17 × 2s = 34 soniya faqat kutish). Fayl yuklash — fayl-omborga oddiy POST, biznes
 * mantiq chaqiruvi emas: draft yaratish yoki save-suit kabi og'ir emas. Shuning uchun ularga
 * qisqaroq interval beriladi, mantiq chaqiruvlari esa REQUEST_GAP_MS da qoladi.
 *
 * ESLATMA: 0.7 soniya sinalgan emas va XAVFLI. 2026-09-07 da 2 soniyaning o'zi portalni
 * yiqitdi, ya'ni fayl yuklash ham «yengil» chaqiruv emas ekan. Hozircha REQUEST_GAP bilan
 * bir xil; pasaytirishdan oldin kichik partiyada sinash shart.
 */
export const UPLOAD_GAP_MS = Math.max(1_000, Number(process.env.CABINET_UPLOAD_GAP_MS) || 4_000);

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
export function paceRequest(gapMs: number = REQUEST_GAP_MS): Promise<void> {
  const next = chain.then(async () => {
    const wait = lastRequestAt + gapMs - Date.now();
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

// ── Umumiy PAUZA ──────────────────────────────────────────────────────────────────────────
// Operator butun sudga yuborish jarayonini to'xtatib turishi mumkin (masalan portal
// javob bermay qolganda yoki hujjatlarda xato topilganda). Job'ning `cancelRequested`
// maydonidan farqi:
//   • cancel — BITTA partiyani tugatadi, qolgan ishlar navbatda qoladi;
//   • pause  — BARCHA firmalarga taalluqli, bazada saqlanadi (restart/deploy'dan keyin ham
//     kuchda qoladi) va yangi partiya boshlanishini ham to'sadi.
// Pauzada ishlar PENDING bo'lib qoladi — davom ettirilganda aynan shu joydan ketadi.
const PAUSE_KEY = 'court_queue_paused';

export async function isQueuePaused(): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: PAUSE_KEY } });
    return row?.value === '1';
  } catch {
    return false; // sozlama o'qilmasa ish to'xtamasin
  }
}

export async function setQueuePaused(paused: boolean): Promise<void> {
  const value = paused ? '1' : '0';
  await prisma.setting.upsert({ where: { key: PAUSE_KEY }, create: { key: PAUSE_KEY, value }, update: { value } });
}
