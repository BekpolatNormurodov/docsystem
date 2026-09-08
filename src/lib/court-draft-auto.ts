// 24/7 AVTOMAT QORALAMA TAYYORLASH.
//
// Operator «Go» bosadi (Setting court_draft_auto = '1') va worker to'xtovsiz, firma-ketma-firma,
// tayyor (sendable) ishlar uchun ADOLAT'da to'liq qoralama tayyorlaydi (save-suit'siz). Sud
// kvotasi/oynasi band qilinmaydi (ignoreQuota) — shuning uchun kechayu kunduz ishlayveradi.
// Tayyorlangan ishlar «Tayyor»dan chiqadi (meta.draftReadyAt), shuning uchun qayta olinmaydi.
//
// CHEKLOVLAR (ataylab):
//   • «Go» qoralamaning O'Z boshqaruvi. Umumiy "Sudga yuborish to'xtatildi" pauzasi FAQAT
//     real yuborishga taalluqli — qoralama xavfsiz (sudga yubormaydi), shuning uchun umumiy
//     pauza uni TO'XTATMAYDI. To'xtatish uchun «Go»ni o'chiring. (ALOHIDA firma pauzasi esa
//     shu firmani chetlab o'tadi — operator xohlasa bitta firmani to'xtatib turishi mumkin.)
//   • Real yuborish yoki boshqa qoralama partiyasi ketayotgan bo'lsa — yangi partiya
//     boshlanmaydi (bir vaqtda bitta COURT_SUBMIT job: real va qoralama aralashmasin).
//   • «Go» o'chirilsa — yangi partiya boshlanmaydi (ketayotgani tugaydi).
import { prisma } from './db';
import { enqueueJob } from './job-dispatch';
import { allocateFirmCases, consumeCourtSend } from './court-routing';
import { pausedFirmIds } from './cabinet/pacer';
import { MAX_COURT_BATCH, selectReadyCaseIds } from './court-ready';

const DRAFT_AUTO_KEY = 'court_draft_auto';

/** 24/7 avto-qoralama yoqilganmi. */
export async function isDraftAutoOn(): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: DRAFT_AUTO_KEY }, select: { value: true } });
    return row?.value === '1';
  } catch {
    return false; // sozlama o'qilmasa — o'chiq
  }
}

export async function setDraftAuto(on: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: DRAFT_AUTO_KEY },
    create: { key: DRAFT_AUTO_KEY, value: on ? '1' : '0' },
    update: { value: on ? '1' : '0' },
  });
}

/** Bitta firma uchun draft partiya yaratadi (tayyor ishlardan). Yaratilmasa null. */
export async function createDraftBatch(
  firmId: number, snapshotId: number | undefined, limit = MAX_COURT_BATCH,
): Promise<{ jobId: number; count: number } | null> {
  const caseIds = await selectReadyCaseIds({ snapshotId, firmId, limit });
  if (!caseIds.length) return null;

  // ignoreQuota=true — qoralama sud kvotasini/oynasini band qilmaydi (24/7).
  const alloc = await allocateFirmCases(firmId, caseIds, new Date(), undefined, true);
  let sendIds = caseIds;
  if (alloc) {
    sendIds = alloc.assignments.map((a) => a.caseId);
    if (!sendIds.length) return null; // hammasi boshqa sudga biriktirilgan (kam)
    // Sudni BIRIKTIRAMIZ (qoralama/ariza matni uchun kerak), limit BAND QILINMAYDI (markSent=false).
    await consumeCourtSend(alloc.assignments, new Date(), false);
  }

  const job = await prisma.job.create({
    data: {
      type: 'COURT_SUBMIT',
      status: 'PENDING',
      snapshotId: snapshotId ?? null,
      total: sendIds.length,
      // suitMode: save-suit → ADOLAT'da REAL ish «Murojaatlarim»da (xuddi realga ketyotgandek),
      // lekin send-to-court QILINMAYDI — yurist oxirgi «Sudga yuborish»ни O'ZI bosadi.
      params: { firmId, snapshotId, caseIds: sendIds, ready: true, talabnomaPdf: true, includeGrafik: false, markExported: false, suitMode: true },
    },
  });
  enqueueJob(job.id);
  return { jobId: job.id, count: sendIds.length };
}

/**
 * Worker sikli uchun bitta qadam: shart bo'lsa navbatdagi firmaga qoralama partiyasi boshlaydi.
 * Hech narsa qilmasa `null`, aks holda nima qilinganini qaytaradi.
 */
export async function draftAutoTick(): Promise<string | null> {
  if (!(await isDraftAutoOn())) return null;      // «Go» o'chiq
  // ⚠️ Umumiy "Sudga yuborish to'xtatildi" pauzasini QASDAN tekshirmaymiz: u faqat REAL
  // yuborishni to'xtatadi. Qoralama xavfsiz (sudga yubormaydi) — «Go» uning o'z boshqaruvi.
  // Faqat ALOHIDA firma pauzasiga bo'ysunamiz (quyida `pausedFirmIds`).

  // BIR VAQTDA BITTA COURT_SUBMIT job — real yuborish ham, qoralama ham. Real ketayotganda
  // qoralama boshlanmaydi (va aksincha): ikkalasi bir vaqtda portalga chiqmasin.
  const active = await prisma.job.count({ where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } } });
  if (active > 0) return null;

  const [snap, pausedFirms, recentJobs] = await Promise.all([
    prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } }),
    pausedFirmIds().then((ids) => new Set(ids)), // faqat firma-darajali pauza (umumiysini emas)
    // Firma bo'yicha OXIRGI tugagan qoralama partiyasi natijasi — buzuq firmani aniqlash uchun.
    prisma.job.findMany({
      where: { type: 'COURT_SUBMIT', status: { in: ['DONE', 'FAILED'] } },
      orderBy: { id: 'desc' }, take: 40, select: { progress: true, total: true, params: true },
    }),
  ]);

  // BUZUQ firma = oxirgi qoralama partiyasi 0 ta chiqargan (hammasi xato: claimant yo'q, sud
  // yopiq, sessiya tugagan...). Bunday firma har tickда birinchi bo'lib partiya olib, sog'lom
  // firmalarni bloklab qo'ymasin (audit: firma-ochligi). Faqat ENG OXIRGI partiya hisobga olinadi.
  const stuck = new Set<number>();
  const seenFirm = new Set<number>();
  for (const j of recentJobs) {
    const p = j.params as { firmId?: number; draftMode?: boolean; suitMode?: boolean } | null;
    if (p?.suitMode !== true && p?.draftMode !== true) continue; // faqat qoralama/suit partiyalari
    const fid = Number(p.firmId);
    if (!Number.isInteger(fid) || seenFirm.has(fid)) continue;
    seenFirm.add(fid);                                  // shu firmaning eng oxirgisi
    if ((j.total ?? 0) > 0 && (j.progress ?? 0) === 0) stuck.add(fid);
  }

  // TO'LIQ DRENAJ: firmalarni id tartibida yuramiz va BIRINCHI sog'lom firmaga partiya beramiz.
  // U firma har tickда yana tanlanadi — TAYYOR ISHI TUGAGUNCHA (drain), keyin keyingisiga
  // o'tadi. Shunda operator «BRIGHT hammasi ketyapti» deb ko'radi, 200 da to'xtab qolmaydi.
  //   1-o'tish: sog'lom firmalar (tez, ishonchli).
  //   2-o'tish: sog'lomlarda ish qolmasa — buzuqlarni ham QAYTA urinamiz (o'tkinchi xato tuzaladi;
  //             butunlay buzuq bo'lsa faqat boshqa ish qolmaganda bitta tick sarflaydi).
  const firms = await prisma.firm.findMany({ select: { id: true, shortName: true }, orderBy: { id: 'asc' } });
  for (const pass of [0, 1] as const) {
    for (const f of firms) {
      if (pausedFirms.has(f.id)) continue;              // shu firma alohida to'xtatilgan
      if (pass === 0 && stuck.has(f.id)) continue;      // 1-o'tishda buzuqlar chetlab o'tiladi
      if (pass === 1 && !stuck.has(f.id)) continue;     // 2-o'tishda faqat buzuqlar
      const made = await createDraftBatch(f.id, snap?.id ?? undefined);
      if (made) return `firma ${f.id} (${f.shortName}): #${made.jobId} — ${made.count} ta qoralama tayyorlanmoqda`;
    }
  }
  return null; // hech kimda tayyor ish qolmadi
}
