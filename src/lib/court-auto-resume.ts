// Sudga yuborish navbatini AVTOMAT davom ettirish (portal bloklaganda o'sib boruvchi kutish).
//
// Muammo: portal vaqti-vaqti bilan rad eta boshlaydi (500, TLS uzilishi). 2026-09-07 da shunday
// bo'ldi — 12 ta ish ketgach 9 tasi ketma-ket yiqildi. Navbat to'xtardi va operator qo'lda
// `court-resume.ts` ni ishga tushirishi kerak edi. Ya'ni kechasi yoki tushlikda blok bo'lsa,
// jarayon soatlab qimirlamay turardi.
//
// Yechim: worker o'zi kuzatib turadi va bloklangandan keyin O'SIB BORUVCHI oraliqda qayta
// urinadi. Portal odatda o'ziga keladi — birinchi urinishlar qisqa (5 daqiqa), agar u ham
// bo'lmasa uzoqroq kutiladi (30 daqiqa, 1 soat, 2 soat). Bu portalni qayta urib blokni
// uzaytirmaydi va ayni paytda operatorni kutib o'tirishga majbur qilmaydi.
//
// CHEKLOVLAR (ataylab):
//   • Operator PAUZA qo'ysa — avtomat davom etmaydi. Pauza inson qarori, uni kod bekor qilmaydi.
//   • Sud kunlik limiti va ish vaqti (cutoff/weekday) baribir amal qiladi — allocateFirmCases
//     tekshiradi. Limit tugagan bo'lsa job yaratilmaydi, ertaga davom etadi.
//   • Ish ketayotgan bo'lsa (RUNNING job) yangi partiya boshlanmaydi.
import { prisma } from './db';
import { enqueueJob } from './job-dispatch';
import { allocateFirmCases, consumeCourtSend } from './court-routing';
import { isQueuePaused } from './cabinet/pacer';
import { MAX_COURT_BATCH } from './court-batch';
import { paidReceiptSet } from './court-ready';

/** Blokdan keyingi kutish jadvali (daqiqa). Oxirgisi keyin ham takrorlanaveradi. */
export const BACKOFF_MINUTES = [5, 5, 5, 30, 60, 120];

const LEVEL_KEY = 'court_queue_backoff_level';
const NEXT_KEY = 'court_queue_next_attempt';

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}
async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Portal bloklaganda chaqiriladi — keyingi urinish vaqtini surib qo'yadi. */
export async function noteQueueBlocked(): Promise<{ level: number; waitMin: number; nextAt: Date }> {
  const level = Math.min(BACKOFF_MINUTES.length - 1, Number(await getSetting(LEVEL_KEY) ?? '0'));
  const waitMin = BACKOFF_MINUTES[level];
  const nextAt = new Date(Date.now() + waitMin * 60_000);
  await setSetting(LEVEL_KEY, String(Math.min(BACKOFF_MINUTES.length - 1, level + 1)));
  await setSetting(NEXT_KEY, nextAt.toISOString());
  return { level, waitMin, nextAt };
}

/** Ish muvaffaqiyatli ketganda — jadval boshiga qaytariladi. */
export async function resetQueueBackoff(): Promise<void> {
  await setSetting(LEVEL_KEY, '0');
  await setSetting(NEXT_KEY, '');
}

/** Hozir yangi urinish qilish mumkinmi (kutish muddati o'tganmi)? */
async function backoffElapsed(): Promise<boolean> {
  const raw = await getSetting(NEXT_KEY);
  if (!raw) return true;
  const t = Date.parse(raw);
  return !Number.isFinite(t) || Date.now() >= t;
}

/**
 * Navbatda tugamagan ishlar uchun yangi COURT_SUBMIT job yaratadi (saytdagi tugma bilan bir xil).
 * Qaytaradi: yaratilgan job id yoki null (yaratilmagan sabab bilan).
 */
export async function createResumeJob(firmId: number, limit = MAX_COURT_BATCH): Promise<{ jobId: number; count: number } | null> {
  // ADOLAT'da ishi BOR (courtCaseId yozilgan) case QAYTA YUBORILMAYDI.
  //
  // FAILED har doim «sudga ketmadi» degani EMAS: save-suit muvaffaqiyatli o'tib,
  // send-to-court uzilgan bo'lishi mumkin — portal so'rovni bajargan, ya'ni da'vo rasman
  // berilgan, bizda esa xato yozilgan. Bunday ishni avtomatik qayta yuborish AYNI ODAMGA
  // IKKINCHI da'vo ochadi (2026-09-07 auditi). Shuning uchun id yozilgan ishlar
  // avtomatikaga umuman tushmaydi — ularni operator qo'lda tekshiradi.
  const cap = Math.min(MAX_COURT_BATCH, Math.max(1, limit));

  // HALI URINILMAGANLAR BIRINCHI.
  //
  // Ilgari PENDING va FAILED bitta so'rovda, `id asc` bo'yicha olinardi — ya'ni navbat
  // boshidagi eski XATO ishlar har partiyada birinchi bo'lib qayta urinilardi va hali
  // umuman urinilmagan ishlar ortda qolardi. 2026-09-07 da aynan shu bo'ldi: boji
  // to'lanmagan #3505 va #3536 har safar partiyaning boshiga chiqib, har biri qoralama
  // yaratib yiqilardi (5-urinish), qolgan 190 ta ish esa qimirlamasdi.
  const fresh = await prisma.courtQueueItem.findMany({
    where: { firmId, state: 'PENDING', case: { courtCaseId: null } },
    orderBy: { id: 'asc' },
    take: cap,
    select: { caseId: true },
  });

  // XATO BERGANLARNI QAYTA URINISH — CHEKLANGAN.
  //
  // Cheksiz qayta urinish ma'nosiz va zararli: har urinish ADOLAT'da qoralama yaratadi
  // va portalga ~15 ta so'rov yuboradi. Uchinchi urinishdan keyin sabab deyarli har doim
  // doimiy (hujjat yo'q, sud noto'g'ri, boji to'lanmagan) — uni kod emas, odam tuzatadi.
  // Bunday ishlar navbatda FAILED bo'lib ko'rinib turadi va operator qo'lda qayta
  // yuborishi mumkin; avtomatika esa ularni tinch qo'yadi.
  const MAX_AUTO_ATTEMPTS = 3;
  const retry = fresh.length >= cap ? [] : await prisma.courtQueueItem.findMany({
    where: {
      firmId,
      state: 'FAILED',
      attempts: { lt: MAX_AUTO_ATTEMPTS },
      case: { courtCaseId: null },
    },
    orderBy: { id: 'asc' },
    take: cap - fresh.length,
    select: { caseId: true },
  });

  // BOJI TO'LANGANLAR NAVBATGA QAYTADI.
  //
  // Boji to'lanmagan ish SKIPPED bo'ladi (xato emas — hali tayyor emas). Lekin buxgalteriya
  // to'lovni o'tkazgach u O'ZI qaytishi kerak, aks holda operator har bir ishni qo'lda
  // qidirib topib qayta bosishga majbur bo'ladi va «to'langach ish o'zi ketadi» degan va'da
  // yolg'on bo'lib qoladi. Shu sababli SKIPPED'lar orasidan kvitansiyasi ENDI PAID
  // bo'lganlari qaytariladi; to'lanmaganlari esa tegilmaydi (portalga behuda chiqmaydi).
  const revived: { caseId: number }[] = [];
  const room = cap - fresh.length - retry.length;
  if (room > 0) {
    const skipped = await prisma.courtQueueItem.findMany({
      where: { firmId, state: 'SKIPPED', case: { courtCaseId: null } },
      orderBy: { id: 'asc' },
      select: { caseId: true, case: { select: { receiptNumber: true } } },
    });
    if (skipped.length) {
      const paid = await paidReceiptSet(skipped.map((x) => x.case?.receiptNumber ?? ''));
      for (const x of skipped) {
        if (revived.length >= room) break;
        if (x.case?.receiptNumber && paid.has(x.case.receiptNumber)) revived.push({ caseId: x.caseId });
      }
    }
  }

  const pending = [...fresh, ...revived, ...retry];
  if (pending.length === 0) return null;

  const caseIds = pending.map((p) => p.caseId);
  const alloc = await allocateFirmCases(firmId, caseIds);
  let sendIds = caseIds;
  if (alloc) {
    sendIds = alloc.assignments.map((a) => a.caseId);
    if (sendIds.length === 0) return null; // kunlik limit tugagan yoki sud oynasi yopiq
    await consumeCourtSend(alloc.assignments);
  }

  const job = await prisma.job.create({
    data: {
      type: 'COURT_SUBMIT',
      status: 'PENDING',
      total: sendIds.length,
      params: { firmId, caseIds: sendIds, ready: true, markExported: true },
    },
  });
  enqueueJob(job.id);
  return { jobId: job.id, count: sendIds.length };
}

/**
 * Worker sikli uchun bitta qadam: shart bo'lsa navbatni o'zi davom ettiradi.
 * Hech narsa qilmasa `null`, aks holda nima qilinganini qaytaradi.
 */
export async function autoResumeTick(): Promise<string | null> {
  if (await isQueuePaused()) return null;                   // operator to'xtatgan — hurmat qilamiz
  if (!(await backoffElapsed())) return null;               // hali kutish muddati tugamagan

  const running = await prisma.job.count({ where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } } });
  if (running > 0) return null;                             // ish allaqachon ketyapti

  // Qaysi firmalarda tugamagan ish bor — eng ko'pidan boshlaymiz.
  // SKIPPED ham hisobga olinadi: firmada faqat boji to'langan SKIPPED ish qolgan bo'lsa ham
  // partiya boshlanishi kerak (createResumeJob o'zi tanlaydi, tanlanmasa null qaytaradi).
  const groups = await prisma.courtQueueItem.groupBy({
    by: ['firmId'],
    where: { state: { in: ['PENDING', 'FAILED', 'SKIPPED'] } },
    _count: { _all: true },
    orderBy: { _count: { firmId: 'desc' } },
  });
  if (groups.length === 0) { await resetQueueBackoff(); return null; }

  for (const g of groups) {
    const made = await createResumeJob(g.firmId);
    if (made) return `firma ${g.firmId}: job #${made.jobId} (${made.count} ta ish) avtomat boshlandi`;
  }
  return null; // hammasida limit tugagan / sud oynasi yopiq — keyingi tsiklda qayta ko'ramiz
}
