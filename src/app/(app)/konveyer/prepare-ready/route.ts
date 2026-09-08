import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { konveyerSnapshots } from '@/lib/konveyer';
import { enqueueJob } from '@/lib/job-dispatch';
import { selectReadyCaseIds, validateSelectedCaseIds, FIRM_REQUIRED_DOCS, FIRM_DOC_LABEL, MAX_COURT_BATCH } from '@/lib/court-ready';
import { MAX_ZIP_BATCH } from '@/lib/court-batch';
import { allocateFirmCases, consumeCourtSend, firmCourtBudgets } from '@/lib/court-routing';
import { isQueuePaused } from '@/lib/cabinet/pacer';

export const runtime = 'nodejs';

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined;
};

// POST { firmId, snapshotId?, limit?, includeExported?, talabnomaPdf? } —
// «Sudga chiqarish»: build the FULL ready packet (talabnoma+ariza+skan-slot+oferta
// +boji, NO grafik) for up to `limit` (max MAX_COURT_BATCH) fully-ready, not-yet-exported cases
// of ONE firm, into one ZIP, and stamp them exported. Returns { jobId, total }.
export async function POST(req: NextRequest) {
  // Match the read routes + the /sud page guard — the side-effectful export must
  // not be reachable by a user who has no 'sud' step grant.
  await requireStep('sud:send');
  const body = await req.json().catch(() => ({}));

  const firmId = num(body?.firmId);
  if (!firmId) return NextResponse.json({ error: 'firmId kerak (har firma alohida chiqariladi)' }, { status: 400 });

  // Firma hujjatlari (guvohnoma/ishonchnoma/shartnoma) TO'LIQ bo'lmasa — sudga yubormaymiz
  // (paket chala ketmasin). UI ham bloklaydi; bu — chetlab o'tishga qarshi server himoyasi.
  const haveDocs = new Set((await prisma.firmDocument.findMany({ where: { firmId }, select: { kind: true } })).map((d) => String(d.kind)));
  const missDocs = FIRM_REQUIRED_DOCS.filter((k) => !haveDocs.has(k));
  if (missDocs.length) return NextResponse.json({ error: `Firma hujjatlari yetishmaydi: ${missDocs.map((k) => FIRM_DOC_LABEL[k] ?? k).join(', ')}. Firmalar → «Hujjatlar»dan yuklang.` }, { status: 400 });
  // Resolve snapshot like the GET routes (validate against real snapshots, else latest)
  // so a missing/invalid snapshotId never runs downstream queries with NO snapshot filter.
  const snaps = await konveyerSnapshots();
  const rawSnap = num(body?.snapshotId);
  const snapshotId = rawSnap && snaps.some((s) => s.id === rawSnap) ? rawSnap : snaps[0]?.id;
  // ZIP eksporti sudga hech narsa yubormaydi: sud kunlik limitini band qilmaydi va
  // «allaqachon chiqarilgan» filtri faqat SHU oqimga tegishli. Shuning uchun bayroq
  // case tanlashdan ham, allokatsiyadan ham, CHEGARADAN ham OLDIN aniqlanadi.
  const isExportOnly = body?.exportOnly === true;
  // QORALAMA rejimi: ADOLAT'da to'liq qoralama tayyorlanadi (save-suit'siz), yurist
  // portalda O'ZI yuboradi. Sud kvotasi/oynasi tekshirilmaydi (24/7), chunki qoralama
  // sudga hech narsa yubormaydi. isExportOnly (ZIP) bilan bir xil «ignoreQuota» yo'lidan.
  const isDraftMode = body?.draftMode === true;
  // ZIP uchun chegara ancha katta: partiya hajmi portalni himoya qilish uchun, ZIP esa
  // portalga tegmaydi. 767 ta tayyorni 200 tadan 4 marta olish ma'nosiz edi.
  const cap = isExportOnly ? MAX_ZIP_BATCH : MAX_COURT_BATCH;
  const limit = Math.min(cap, Math.max(1, num(body?.limit) ?? cap));
  const includeExported = body?.includeExported === true;
  const talabnomaPdf = body?.talabnomaPdf !== false;

  // Optional hand-picked subset from the drill-down (server RE-VALIDATES every id —
  // a stale client selection can never smuggle a non-ready case into the ZIP);
  // otherwise auto-pick the oldest-due ready-and-not-exported cases.
  // Distinct, capped selection (Prisma `in` collapses duplicates, so dedupe first
  // to keep the `skipped` count honest).
  const uniqIds = Array.isArray(body?.caseIds)
    ? [...new Set((body.caseIds as unknown[]).map(Number).filter((x): x is number => Number.isInteger(x) && x > 0))].slice(0, cap)
    : null;
  const caseIds = uniqIds?.length
    // `forExport` — faqat ZIP oqimi allaqachon chiqarilganini o'tkazib yuboradi. Sudga
    // yuborishda ZIP olingani to'siq emas (u sudga hech narsa yubormagan).
    ? await validateSelectedCaseIds({ snapshotId, firmId, caseIds: uniqIds, includeExported, forExport: isExportOnly })
    : await selectReadyCaseIds({ snapshotId, firmId, limit, includeExported, forExport: isExportOnly });
  if (caseIds.length === 0) {
    return NextResponse.json(
      { error: includeExported ? 'Chiqarish uchun tayyor mijoz yoʻq' : 'Yuborishga tayyor (chiqarilmagan) mijoz yoʻq' },
      { status: 400 },
    );
  }
  const skipped = uniqIds ? uniqIds.length - caseIds.length : 0;

  // ── Sud yo'naltirish + kunlik limit ─────────────────────────────────────────────────────────
  // Firmaning sud(lar)i bo'yicha taqsimlaymiz: har sud kunlik limiti/cutoff/ish-kuni bilan.
  // Limitdan oshgani BUGUN yuborilmaydi (keyingi ish kuniga suriladi). Konfiguratsiya bo'lmasa
  // (Court jadvali bo'sh) — alloc=null, hech narsa cheklanmaydi (eski xatti-harakat).
  // Operator modalda sudlarni tanlagan bo'lsa — faqat o'shalarga yuboriladi. Boshqa sudga
  // ALLAQACHON biriktirilgan ish tanlangan sudga KO'CHIRILMAYDI, chetga suriladi
  // (allocateFirmCases ichida): arizada bir sud, da'voda boshqa sud bo'lib qolmasin.
  const courtIds = Array.isArray(body?.courtIds)
    ? [...new Set((body.courtIds as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x > 0))]
    : undefined;

  let sendIds = caseIds;
  let deferred = 0;
  // ZIP (isExportOnly) — sud biriktiriladi, lekin kunlik limit tanlovni KESMAYDI: fayl
  // tayyorlashning sud kunlik quvvatiga ham, ish kuniga ham aloqasi yo'q.
  const alloc = await allocateFirmCases(firmId, caseIds, new Date(), courtIds, isExportOnly || isDraftMode);

  /**
   * BUGUN SIG'MAGAN ISHLAR YO'QOLMASIN — navbatga yozamiz.
   *
   * 2026-09-08: operator BRIGHT'da 200 ta yuborib, qolgan 91 tasini «Navbatga qo'shish»
   * bilan qo'shdi va ular HECH QACHON ketmadi. Sabab: 200 talik partiya yaratilishi bilan
   * consumeCourtSend Uchtepa sudining kunlik limitini (200) TO'LIQ band qiladi, ya'ni 91 ta
   * uchun `remaining` = 0 bo'ladi va allocateFirmCases hammasini `deferred` ga tashlaydi.
   * Route esa 400 qaytarardi, sahifadagi navbat yozuvi «xato» bo'lib qotib qolardi va bu
   * 91 ta ish HECH QAYERDA — na bazada, na navbatda — qolmasdi.
   *
   * Endi ular CourtQueueItem'ga PENDING bo'lib yoziladi (jobId'siz). Bundan keyin:
   *   • darhol «Navbatda» bo'lib ko'rinadi (court-ready shu jadvaldan o'qiydi);
   *   • worker'ning avto-davom sikli keyingi ish kunida o'zi oladi;
   *   • brauzer yopilsa ham yo'qolmaydi.
   * Kunlik limit BAND QILINMAYDI: bu ishlar hali yuborilmagan.
   */
  const parkDeferred = async (ids: number[]): Promise<number> => {
    if (!ids.length || isExportOnly) return 0;
    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { stir: true } });
    const account = (firm?.stir || '').replace(/\D/g, '');
    if (!account) return 0; // STIR'siz navbat yozuvi ma'nosiz — partiya baribir ishlamaydi
    const why = 'Sud kunlik limiti tugagan — keyingi ish kunida avtomat davom etadi';
    let parked = 0;
    for (const caseId of ids) {
      // Allaqachon navbatda yoki yuborilgan ishga TEGMAYMIZ (update: {}) — faqat yangi yozuv.
      const r = await prisma.courtQueueItem.upsert({
        where: { caseId },
        create: { caseId, firmId, account, state: 'PENDING', draftMode: isDraftMode, lastError: why },
        update: {},
      });
      if (r.state === 'PENDING') parked++;
    }
    return parked;
  };

  if (alloc) {
    sendIds = alloc.assignments.map((a) => a.caseId);
    deferred = alloc.deferred.length;
    if (sendIds.length === 0) {
      // ZIP bu yerga SUD OYNASI/LIMITI sabab TUSHMAYDI: allocateFirmCases ignoreQuota=true
      // bilan chaqiriladi, ya'ni dam olish kuni ham, cutoffdan keyin ham tanlov kesilmaydi.
      // Qolgan yagona sabab — sud MOSLIGI (tanlangan sud firmaga ruxsat etilmagan yoki ishlar
      // boshqa sudga biriktirilgan) yoki ro'yxat eskirgani. Shunga qaramay bu shoxda umumiy
      // «Bugun sudga yuborib bo‘lmaydi (keyingi ish kuniga suriladi)» matni chiqardi — yuklab
      // olish uchun ma'nosiz xabar edi va operator ZIP tugmasi buzilgan deb o'ylardi
      // (2026-09-08 audit). ZIP sudga bitta ham hujjat yubormaydi, shuning uchun matnda ham
      // sudga yuborish/keyingi ish kuni haqida gap bo'lmasligi kerak.
      if (isExportOnly) {
        return NextResponse.json(
          {
            error: courtIds?.length
              ? `ZIP tayyorlanmadi: tanlangan sud(lar) bo‘yicha mos mijoz yo‘q — ${alloc.deferred.length} ta ish boshqa sudga biriktirilgan yoki bu sud firmaga ruxsat etilmagan. Sud tanlovini o‘zgartiring.`
              : 'ZIP tayyorlanmadi: tanlangan mijozlar topilmadi (ro‘yxat eskirgan bo‘lishi mumkin). Sahifani yangilab qayta urinib ko‘ring.',
          },
          { status: 400 },
        );
      }
      // Bugun hech nima ketmaydi — sababini tushuntiramiz (yopiq oyna yoki limit tugagan).
      const budgets = await firmCourtBudgets(firmId);
      const parts = budgets.map((b) => {
        const w = b.window.reason === 'weekend' ? 'ish kuni emas'
          : b.window.reason === 'past-cutoff' ? 'vaqt tugagan'
          : b.window.reason === 'inactive' ? 'o‘chirilgan'
          : `${b.remaining}/${b.court.dailyQuota} qoldi`;
        return `${b.court.shortName}: ${w}`;
      });
      const courtNote = courtIds?.length ? ' (faqat tanlangan sud(lar) hisobga olindi)' : '';
      // Bugun bittasi ham ketmaydi — LEKIN bu xato emas. Ishlar navbatga qo'yiladi va bu
      // MUVAFFAQIYAT deb qaytariladi: ular keyingi ish kunida o'zi ketadi. Ilgari bu yerda
      // 400 qaytarilib, ishlar butunlay yo'qolardi.
      const parked = await parkDeferred(alloc.deferred);
      if (parked > 0) {
        return NextResponse.json({
          jobId: null, queued: parked, reason: 'QUOTA',
          message: `${parked} ta ish navbatga qo‘yildi — keyingi ish kunida avtomat yuboriladi${courtNote}. ${parts.join(' · ')}`,
        });
      }
      return NextResponse.json(
        { error: `Bugun sudga yuborib bo‘lmaydi (keyingi ish kuniga suriladi)${courtNote}. ${parts.join(' · ')}` },
        { status: 400 },
      );
    }
    // markSent — kunlik limit sanog'ini band qiladimi. ZIP (isExportOnly) va QORALAMA
    // (isDraftMode) sudga hech narsa yubormaydi, shuning uchun ikkalasida ham band
    // qilinmaydi: sud biriktiriladi (ariza/qoralama matni uchun), limit esa erkin qoladi.
    await consumeCourtSend(alloc.assignments, new Date(), !isExportOnly && !isDraftMode);
    // Bugunga sig'magani (limit/oyna) ham yo'qolmasin — navbatda qoladi.
    // Qoralama 24/7: ignoreQuota bilan deferred faqat sud-mosligi bo'yicha bo'ladi (kam).
    if (alloc.deferred.length && !isDraftMode) await parkDeferred(alloc.deferred);
  }

  // Saytdan sudga yuborishda real topshirish dvigateli (COURT_SUBMIT) ishlaydi.
  // Agar exportOnly: true berilsa, faqat ZIP fayl tayyorlash (PACKET) bajariladi.
  const jobType = isExportOnly ? 'PACKET' : 'COURT_SUBMIT';

  // Umumiy pauza YANGI partiyani ham to'sadi (faqat ketayotganini emas). ZIP tayyorlash
  // portalga tegmaydi — u pauzadan qat'i nazar ishlayveradi.
  // BIR FIRMAGA IKKITA PARTIYA bo'lmasin. Operator tugmani ikki marta bosса yoki sahifa
  // ikki joyda ochiq bo'lsa, bir xil ishlar ustidan ikkita job yaralardi. Ishning o'zi
  // ikki marta yuborilmaydi (DONE tekshiruvi bor), lekin navbat chalkashadi va operator
  // qaysi biri haqiqiy ekanini bilmaydi. ZIP eksportiga bu cheklov tegishli emas.
  // BIR FIRMAGA IKKITA ZIP ham bo'lmasin. ZIP portalga tegmaydi, lekin ikkita bir xil
  // partiya ayni vaqtda 616 tadan mijozni ikki marta render qiladi (chromium'ni ikki
  // barobar band qiladi) va operator qaysi havola qaysi biri ekanini bilmaydi. Sud
  // partiyasidan farqli — bu yerda javob 409 emas, chunki zarar yo'q: shunchaki
  // ketayotganini aytamiz.
  if (isExportOnly) {
    const activeZip = await prisma.job.findFirst({
      where: { type: 'PACKET', status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, status: true, params: true, progress: true, total: true },
    });
    if (activeZip && Number((activeZip.params as { firmId?: number } | null)?.firmId) === firmId) {
      return NextResponse.json(
        { error: `Bu firma uchun ZIP allaqachon ${activeZip.status === 'RUNNING' ? `tayyorlanmoqda (${activeZip.progress}/${activeZip.total})` : 'navbatda'}. Tugashini kuting yoki «Bekor» qiling.` },
        { status: 409 },
      );
    }
  }

  if (!isExportOnly) {
    // Faol partiyalarning HAMMASI ko'rib chiqiladi. Ilgari `findFirst` bilan faqat bitta
    // tasodifiy job olinardi: boshqa firmada partiya ketayotgan bo'lsa, bu firmaning
    // takroriga to'siq JIM ishlamay qolardi (2026-09-07 auditi).
    const actives = await prisma.job.findMany({
      where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, status: true, params: true },
    });
    const active = actives.find((j) => Number((j.params as { firmId?: number } | null)?.firmId) === firmId);
    if (active) {
      // MUTUAL EXCLUSION — real yuborish va qoralama tayyorlash bir firmada BIR VAQTDA
      // ishlamaydi. Xabar aynan qaysi rejim ketayotganini aytadi: operator «real ketyapti,
      // qoralama kuting» yoki aksincha ekanini darrov tushunsin (2026-09-08 operator qarori).
      const activeDraft = (active.params as { draftMode?: boolean } | null)?.draftMode === true;
      const activeWord = activeDraft ? 'qoralama tayyorlanmoqda' : 'sudga yuborilmoqda';
      const wantWord = isDraftMode ? 'qoralama tayyorlash' : 'sudga yuborish';
      return NextResponse.json(
        { error: `Bu firmada hozir ${activeWord} (#${active.id}, ${active.status === 'RUNNING' ? 'ketyapti' : 'navbatda'}). Tugashini kuting — «${wantWord}» birga ishlamaydi (ikkalasi bir vaqtda portalga chiqmasligi kerak).` },
        { status: 409 },
      );
    }
  }

  if (!isExportOnly && (await isQueuePaused(firmId))) {
    return NextResponse.json(
      { error: 'Sudga yuborish jarayoni pauzada. Davom ettirish uchun «Davom ettirish» tugmasini bosing.' },
      { status: 409 },
    );
  }

  const job = await prisma.job.create({
    data: {
      type: jobType,
      status: 'PENDING',
      snapshotId: snapshotId ?? null,
      total: sendIds.length,
      params: { firmId, snapshotId, caseIds: sendIds, ready: true, talabnomaPdf, includeGrafik: false, markExported: !isDraftMode, draftMode: isDraftMode },
    },
  });

  // Run inline (default) or leave PENDING for the Docker worker (JOB_MODE=worker).
  enqueueJob(job.id);

  // `skipped`/`deferred` additive — existing callers read only jobId/total.
  // `type` — UI uchun: PACKET tugagach ZIP havolasi ko'rsatiladi, COURT_SUBMIT tugagach esa
  // yakuniy hisobot matni (ZIP yo'q — bu job fayl yaratmaydi, havola 404 berardi).
  return NextResponse.json({ jobId: job.id, type: jobType, total: sendIds.length, skipped, deferred });
}
