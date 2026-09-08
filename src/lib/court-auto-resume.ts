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
import { paidReceiptSet, unpaidQueueReason } from './court-ready';

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

  // ── ESKI «XATO»LARNI TO'G'RI NOMLASH ────────────────────────────────────────────────────
  //
  // Boji to'lanmagan ish endi SKIPPED bo'ladi, lekin bu qoida joriy qilinishidan OLDIN
  // yiqilganlari FAILED bo'lib qolgan (2026-09-07: BRIGHT'da 5 ta, matni «Pochta
  // kvitansiyasi portalda tasdiqlanmadi»). Ular ikki jihatdan noto'g'ri turibdi:
  //   • operator ularni «kod xatosi» deb o'qiydi, aslida qilinadigan ish — to'lov;
  //   • urinishlar chegarasi (MAX_AUTO_ATTEMPTS) tufayli avtomatikadan butunlay chiqib
  //     ketgan, ya'ni boji TO'LANGANDA ham hech qachon qaytmasdi.
  // Shuning uchun har partiyadan oldin holatni ma'lumotga qarab qayta baholaymiz:
  // kvitansiyasi to'lanmagan FAILED ish — SKIPPED. To'langach yuqoridagi «revived»
  // shoxobchasi uni o'zi navbatga qaytaradi.
  const staleFailed = await prisma.courtQueueItem.findMany({
    where: { firmId, state: 'FAILED', case: { courtCaseId: null } },
    select: { caseId: true, case: { select: { receiptNumber: true } } },
  });
  if (staleFailed.length) {
    const paidNow = await paidReceiptSet(staleFailed.map((x) => x.case?.receiptNumber ?? ''));
    const unpaidIds = staleFailed
      .filter((x) => !x.case?.receiptNumber || !paidNow.has(x.case.receiptNumber))
      .map((x) => x.caseId);
    if (unpaidIds.length) {
      await prisma.courtQueueItem.updateMany({
        where: { caseId: { in: unpaidIds } },
        data: {
          state: 'SKIPPED',
          step: null,
          lastError: 'Davlat boji to\'lanmagan. Buxgalteriyaga to\'lovga bering — to\'langach ish o\'zi navbatga qaytadi.',
        },
      });
    }
  }

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

  // BOJI TO'LANGANLAR NAVBATGA QAYTADI — XATO BERGANLARDAN OLDIN.
  //
  // Boji to'lanmagan ish SKIPPED bo'ladi (xato emas — hali tayyor emas). Lekin buxgalteriya
  // to'lovni o'tkazgach u O'ZI qaytishi kerak, aks holda operator har bir ishni qo'lda
  // qidirib topib qayta bosishga majbur bo'ladi va «to'langach ish o'zi ketadi» degan va'da
  // yolg'on bo'lib qoladi. Shu sababli SKIPPED'lar orasidan kvitansiyasi ENDI PAID
  // bo'lganlari qaytariladi; to'lanmaganlari esa tegilmaydi (portalga behuda chiqmaydi).
  //
  // Nega qayta urinishlardan OLDIN: to'langan ish yuborishga tayyor va sabab yo'q, xato
  // bergan ish esa allaqachon bir marta yiqilgan. Aks holda bir necha o'nlab FAILED butun
  // partiya joyini egallab, endigina to'langan ish yana kutib qolardi.
  const revived: { caseId: number }[] = [];
  if (fresh.length < cap) {
    const skipped = await prisma.courtQueueItem.findMany({
      where: { firmId, state: 'SKIPPED', case: { courtCaseId: null } },
      orderBy: { id: 'asc' },
      select: { caseId: true, case: { select: { receiptNumber: true } } },
    });
    if (skipped.length) {
      const paid = await paidReceiptSet(skipped.map((x) => x.case?.receiptNumber ?? ''));
      const room = cap - fresh.length;
      for (const x of skipped) {
        if (revived.length >= room) break;
        if (x.case?.receiptNumber && paid.has(x.case.receiptNumber)) revived.push({ caseId: x.caseId });
      }
    }
  }

  // XATO BERGANLARNI QAYTA URINISH — CHEKLANGAN.
  //
  // Cheksiz qayta urinish ma'nosiz va zararli: har urinish ADOLAT'da qoralama yaratadi
  // va portalga ~15 ta so'rov yuboradi. Uchinchi urinishdan keyin sabab deyarli har doim
  // doimiy (hujjat yo'q, sud noto'g'ri) — uni kod emas, odam tuzatadi. Bunday ishlar
  // navbatda FAILED bo'lib ko'rinib turadi va operator qo'lda qayta yuborishi mumkin;
  // avtomatika esa ularni tinch qo'yadi.
  const MAX_AUTO_ATTEMPTS = 3;
  const failed = await prisma.courtQueueItem.findMany({
    where: { firmId, state: 'FAILED', case: { courtCaseId: null } },
    orderBy: { id: 'asc' },
    take: MAX_COURT_BATCH,
    select: { caseId: true, attempts: true, case: { select: { receiptNumber: true } } },
  });

  // BOJI TO'LANMAGAN ISH «XATO» EMAS — QAYTA NOMLANADI.
  //
  // Bunday ishlar avvalgi kodda qizil «Yuborilmadi» bo'lib qolgan edi (#3505, #3536,
  // #3567 — 4-5 urinish), garchi kod ham, portal ham to'g'ri ishlagan bo'lsa-da: yagona
  // yetishmayotgan narsa TO'LOV. Qizil xato operatorni kod qidirishga yuboradi, holbuki
  // qilinadigan ish buxgalteriyada. Shuning uchun ular shu yerda SKIPPED'ga o'tkaziladi:
  // sabab ko'rinadi, avtomatika ularni qayta urinmaydi, to'langach esa yuqoridagi
  // `revived` ularni o'zi qaytaradi.
  const failedPaid = await paidReceiptSet(failed.map((x) => x.case?.receiptNumber ?? ''));
  const failedUnpaid = failed.filter((x) => !x.case?.receiptNumber || !failedPaid.has(x.case.receiptNumber));
  for (const x of failedUnpaid) {
    await prisma.courtQueueItem.update({
      where: { caseId: x.caseId },
      data: { state: 'SKIPPED', step: null, finishedAt: new Date(), lastError: unpaidQueueReason(x.case?.receiptNumber ?? null) },
    });
  }
  if (failedUnpaid.length) {
    // Kunlik sud limitini ham bo'shatamiz — yuborilmagan ish joyni band qilib turmasin.
    await prisma.arizaCase.updateMany({
      where: { id: { in: failedUnpaid.map((x) => x.caseId) }, stage: { not: 'COURT_SUBMITTED' } },
      data: { courtSentAt: null },
    });
    console.log(`[auto-resume] firma ${firmId}: ${failedUnpaid.length} ta «xato» aslida boji to'lanmagani — o'tkazilganlar qatoriga ko'chirildi`);
  }

  const room = cap - fresh.length - revived.length;
  const retry = room <= 0 ? [] : failed
    .filter((x) => x.attempts < MAX_AUTO_ATTEMPTS && x.case?.receiptNumber && failedPaid.has(x.case.receiptNumber))
    .slice(0, room)
    .map((x) => ({ caseId: x.caseId }));

  const pending = [...fresh, ...revived, ...retry];
  if (pending.length === 0) return null;

  const caseIds = pending.map((p) => p.caseId);

  // PARTIYA REJIMINI SAQLAYMIZ. Uzilgan qoralama partiyasi qoralama, real esa real bo'lib
  // davom etsin — aks holda avto-davom qoralamani REAL sudga topshirib qo'yardi (qaytarib
  // bo'lmaydi). Aralash bo'lsa xavfsiz tomon: QORALAMA (real emas). Qoralama sud kvotasini
  // band qilmaydi (ignoreQuota) va limit iste'mol qilmaydi.
  const modeRows = await prisma.courtQueueItem.findMany({
    where: { caseId: { in: caseIds } }, select: { draftMode: true },
  });
  const draftMode = modeRows.length > 0 && modeRows.every((r) => r.draftMode === true);

  const alloc = await allocateFirmCases(firmId, caseIds, new Date(), undefined, draftMode);
  let sendIds = caseIds;
  if (alloc) {
    sendIds = alloc.assignments.map((a) => a.caseId);
    if (sendIds.length === 0) return null; // kunlik limit tugagan yoki sud oynasi yopiq
    if (!draftMode) await consumeCourtSend(alloc.assignments);
  }

  const job = await prisma.job.create({
    data: {
      type: 'COURT_SUBMIT',
      status: 'PENDING',
      total: sendIds.length,
      params: { firmId, caseIds: sendIds, ready: true, markExported: !draftMode, draftMode },
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
    // FIRMA DARAJASIDAGI PAUZANI ham hurmat qilamiz.
    //
    // Yuqoridagi tekshiruv faqat UMUMIY pauzani ko'rardi. Operator bitta firmani
    // to'xtatib qo'ysa, avtomat har daqiqada o'sha firmaga job yaratar, job esa darhol
    // «Pauza — operator jarayonni to'xtatgan» deb tugardi: 2026-09-08 da shu tarzda
    // ketma-ket 7 ta bo'sh job (#239-#245) paydo bo'lgan va partiyalar tarixi
    // shulardan iborat bo'lib qolgan edi. Endi to'xtatilgan firma o'tkazib yuboriladi.
    if (await isQueuePaused(g.firmId)) continue;
    const made = await createResumeJob(g.firmId);
    if (made) return `firma ${g.firmId}: job #${made.jobId} (${made.count} ta ish) avtomat boshlandi`;
  }
  return null; // hammasida limit tugagan / sud oynasi yopiq — keyingi tsiklda qayta ko'ramiz
}
