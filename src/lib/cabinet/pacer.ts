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
// Chegara ikki qatlamli: jarayon ichida (tez) va BAZA orqali (jarayonlararo). Ikkinchisi
// 2026-09-07 da qo'shildi — avval faqat xotirada edi va `docker exec` bilan ishga tushirilgan
// skript worker bilan bir vaqtda ishlaganda portalga ikki barobar tezlikda urilib, fayl
// yuklashda ulanish uzilgan edi.

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

// ── JARAYONLARARO chegara (baza orqali) ───────────────────────────────────────────────────
//
// 2026-09-07: chegara faqat XOTIRADA edi, ya'ni har jarayon o'zinikini yuritardi. Worker
// partiyani yuritayotganda `docker exec ... send-one-live.ts` alohida jarayonda ishga
// tushirildi — ikkalasi bir-birini ko'rmadi va portalga IKKI BAROBAR tezlikda urildi.
// Natija: fayl yuklashda «fetch failed (other side closed)». Endi so'rov huquqi BAZADAN
// olinadi, shuning uchun worker, skript va sayt — hammasi bitta chegarani baham ko'radi.
const SLOT_KEY = 'cabinet_last_request_at';

/**
 * So'rov huquqini ATOMAR oladi: yozuvni faqat «oxirgi so'rovdan gapMs o'tgan bo'lsa»
 * yangilaydi. MySQL qatorni qulflagani uchun ikki jarayon bir vaqtda muvaffaqiyatli
 * yangilay olmaydi — yutqazgani kutib qayta uradi.
 *
 * Baza javob bermasa (`null`) — chaqiruvchi xotiradagi chegaraga tushadi: tarmoq
 * cheklovi buzilgandan ko'ra ish sekin ketgani yaxshi, lekin butunlay to'xtab qolmasin.
 */
async function claimSlotViaDb(gapMs: number): Promise<'ok' | 'busy' | null> {
  try {
    const now = Date.now();
    const n = await prisma.$executeRaw`
      UPDATE Setting SET value = ${String(now)}
      WHERE \`key\` = ${SLOT_KEY} AND CAST(value AS UNSIGNED) <= ${now - gapMs}
    `;
    if (n > 0) return 'ok';
    // Yozuv yo'q bo'lsa — bir marta yaratamiz (keyingi urinishda oddiy yo'ldan ketadi).
    const exists = await prisma.setting.findUnique({ where: { key: SLOT_KEY }, select: { key: true } });
    if (!exists) {
      await prisma.setting.create({ data: { key: SLOT_KEY, value: '0' } }).catch(() => {});
      return 'busy';
    }
    return 'busy';
  } catch {
    return null; // baza mavjud emas / xato — xotiradagi chegaraga tushamiz
  }
}

/**
 * Har bir cabinet HTTP so'rovidan OLDIN chaqiriladi. Oldingi so'rovdan `gapMs` o'tmagan
 * bo'lsa — kutadi. Chegara BARCHA jarayonlar uchun umumiy (baza orqali); baza ishlamasa
 * jarayon ichidagi zanjir zaxira bo'lib qoladi.
 */
export function paceRequest(gapMs: number = REQUEST_GAP_MS): Promise<void> {
  const next = chain.then(async () => {
    // 1) Jarayon ichidagi chegara — arzon va darrov ishlaydi.
    const localWait = lastRequestAt + gapMs - Date.now();
    if (localWait > 0) await sleep(localWait);

    // 2) Jarayonlararo chegara. Har urinish orasida qisqa kutish; umumiy kutish
    //    gapMs ning 3 barobaridan oshsa — o'tkazamiz (tiqilib qolmaslik uchun).
    const deadline = Date.now() + gapMs * 3;
    for (;;) {
      const r = await claimSlotViaDb(gapMs);
      if (r === 'ok' || r === null) break;
      if (Date.now() > deadline) break;
      await sleep(Math.min(gapMs, 1_000));
    }
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
// Pauza IKKI darajali:
//   • UMUMIY  (`court_queue_paused`)       — barcha firmalarga;
//   • FIRMA   (`court_queue_paused:<id>`)  — faqat o'sha firmaga.
// Firma darajasi kerak bo'ldi (2026-09-07): BRIGHT'ning 200 talik partiyasi ketayotganda
// URBAN'ning 3 tasi ortida ~3 soat kutib qoldi. Endi bitta firmani to'xtatib, boshqasini
// o'tkazib yuborish mumkin.
const PAUSE_KEY = 'court_queue_paused';
const firmPauseKey = (firmId: number) => `${PAUSE_KEY}:${firmId}`;

/** Umumiy pauza YOKI shu firmaning pauzasi yoqilganmi. */
export async function isQueuePaused(firmId?: number | null): Promise<boolean> {
  try {
    const keys = firmId ? [PAUSE_KEY, firmPauseKey(firmId)] : [PAUSE_KEY];
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } }, select: { value: true } });
    return rows.some((r) => r.value === '1');
  } catch {
    return false; // sozlama o'qilmasa ish to'xtamasin
  }
}

/** FAQAT shu firmaning pauzasi (umumiy pauzani HISOBGA OLMAYDI). Qoralama jobi uchun: qoralama
 *  xavfsiz, umumiy "Sudga yuborish to'xtatildi" uni to'xtatmasligi kerak — faqat firma pauzasi. */
export async function isFirmPaused(firmId: number): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: firmPauseKey(firmId) }, select: { value: true } });
    return row?.value === '1';
  } catch {
    return false;
  }
}

/** Faqat FIRMA darajasidagi pauza (umumiysini hisobga olmaydi) — UI holatini ko'rsatish uchun. */
export async function pausedFirmIds(): Promise<number[]> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { startsWith: `${PAUSE_KEY}:` }, value: '1' },
      select: { key: true },
    });
    return rows.map((r) => Number(r.key.split(':')[1])).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/** `firmId` berilsa — faqat o'sha firma to'xtaydi/davom etadi; berilmasa — umumiy pauza. */
export async function setQueuePaused(paused: boolean, firmId?: number | null): Promise<void> {
  const key = firmId ? firmPauseKey(firmId) : PAUSE_KEY;
  const value = paused ? '1' : '0';
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
