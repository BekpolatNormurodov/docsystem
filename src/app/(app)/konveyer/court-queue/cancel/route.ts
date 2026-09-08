import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { setQueuePaused } from '@/lib/cabinet/pacer';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// POST { firmId } — FIRMA NAVBATINI BUTUNLAY BEKOR QILISH.
//
// «To'xtatish» (pauza) dan FARQI: pauza ishlarni navbatda QOLDIRADI va «Davom ettirish»
// bosilganda aynan o'sha joydan ketadi. Bekor qilish esa navbatni CHOPADI — qolgan ishlar
// ro'yxatdan olib tashlanadi.
//
// NEGA KERAK (operator, 2026-09-08): 200 talik partiya boshlangan, 100 tasi ketgan,
// qolgan 100 tasi kerak emas. Pauza buni yechmasdi — u faqat to'xtatib turadi, ish esa
// navbatda qolib, keyingi «Davom ettirish»da yoki avtomat davom ettirishda baribir ketardi.
// Yagona chora navbatni qo'lda tozalash edi, uni esa UI umuman taklif qilmasdi.
//
// KAFOLATLAR:
//   • YUBORILGANLARGA TEGILMAYDI. `DONE` yozuvlar ham, ishning o'z bosqichi ham
//     o'zgarmaydi — 100 ta ketgan bo'lsa, o'sha 100 tasi sudda qolaveradi.
//   • Ayni damda PORTALDA ketayotgan bitta ish (`RUNNING`) tugashiga qo'yiladi: uni
//     yarim yo'lda uzish ADOLAT'da yetim qoralama qoldiradi yoki, eng yomoni, da'vo
//     berilgan bo'lsa ham bizda «bekor qilindi» bo'lib yozilib qoladi.
//   • Firma PAUZAGA olinadi. Busiz avtomat davom ettiruvchi bir daqiqadan keyin
//     xato bergan ishlardan yangi partiya boshlab yuborardi — ya'ni «bekor qildim»
//     degan operator jarayonning o'zidan qayta boshlanganini ko'rardi.
//   • Kunlik sud limiti qaytariladi: bekor qilingan ishlarga partiya boshlanishida
//     `courtSentAt` yozilgan, lekin ular yuborilmadi.
export async function POST(req: NextRequest) {
  await requireStep('sud:send');
  const body = await req.json().catch(() => ({}));
  const raw = Number(body?.firmId);
  const firmId = Number.isInteger(raw) && raw > 0 ? raw : null;
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { shortName: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  // 1) Avval PAUZA — keyingi qadamlar davomida avtomat yangi partiya boshlab yubormasin.
  await setQueuePaused(true, firmId);

  // 2) Shu firmaning faol partiyalari. PENDING (hali boshlanmagan) darhol CANCELED bo'ladi —
  //    uni ishga tushirishning ma'nosi yo'q. RUNNING esa `cancelRequested` oladi va o'zi
  //    keyingi ish oldidan to'xtaydi (runCourtSubmitJob har ish boshida tekshiradi).
  const actives = await prisma.job.findMany({
    where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true, status: true, params: true },
  });
  const mine = actives.filter((j) => Number((j.params as { firmId?: number } | null)?.firmId) === firmId);
  let stoppedJobs = 0;
  for (const j of mine) {
    if (j.status === 'PENDING') {
      const r = await prisma.job.updateMany({
        where: { id: j.id, status: 'PENDING' },
        data: { status: 'CANCELED', message: 'Operator navbatni bekor qildi' },
      });
      stoppedJobs += r.count;
    } else {
      const r = await prisma.job.updateMany({
        where: { id: j.id, status: 'RUNNING' },
        data: { cancelRequested: true },
      });
      stoppedJobs += r.count;
    }
  }

  // 3) Navbatdagi (hali urinilmagan) yozuvlarni ro'yxatdan olib tashlaymiz.
  //
  //    NEGA O'CHIRAMIZ, `SKIPPED` qilmaymiz: SKIPPED — «boji to'lanmagan» holati va
  //    to'langach avtomat qaytariladi (court-auto-resume `revived`). Bekor qilingan ish
  //    esa qaytmasligi kerak — operator uni ataylab chiqarib tashladi. O'chirilgani
  //    hech narsani yo'qotmaydi: ishning o'zi «Tayyor» bo'lib qolaveradi va operator
  //    xohlasa qaytadan «Sudga yuborish» bilan navbatga qo'shadi.
  //
  //    RUNNING tegilmaydi — yuqoridagi izohga qarang.
  const pending = await prisma.courtQueueItem.findMany({
    where: { firmId, state: 'PENDING' },
    select: { caseId: true },
  });
  const caseIds = pending.map((p) => p.caseId);
  if (caseIds.length) {
    await prisma.courtQueueItem.deleteMany({ where: { firmId, state: 'PENDING' } });
    // 4) Kunlik limitni qaytaramiz — bu ishlar yuborilmadi. Sudga HAQIQATAN ketganlarga
    //    (stage COURT_SUBMITTED) tegilmaydi: ular limitni haqli ravishda band qiladi.
    await prisma.arizaCase.updateMany({
      where: { id: { in: caseIds }, stage: { not: 'COURT_SUBMITTED' } },
      data: { courtSentAt: null },
    });
  }

  // OSILIB QOLGAN «RUNNING» YOZUV — bekor qilingan navbatda qolmasin.
  //
  // RUNNING yozuv faqat HAQIQATAN ish ketayotganda ma'noli. Agar bu firmada RUNNING job
  // bo'lmasa, u o'lik yozuv (worker o'rtada uzilgan). Uni qoldirsak worker keyingi startda
  // `resetInterruptedCourtJobs` orqali PENDING'ga qaytaradi — ya'ni operator BEKOR QILGAN
  // navbatda bitta ish o'z-o'zidan tirilib, pauza olingach sudga ketardi.
  const stillRunningJob = mine.some((j) => j.status === 'RUNNING');
  if (!stillRunningJob) {
    const zombie = await prisma.courtQueueItem.findMany({
      where: { firmId, state: 'RUNNING' }, select: { caseId: true },
    });
    if (zombie.length) {
      await prisma.courtQueueItem.deleteMany({ where: { firmId, state: 'RUNNING' } });
      await prisma.arizaCase.updateMany({
        where: { id: { in: zombie.map((z) => z.caseId) }, stage: { not: 'COURT_SUBMITTED' } },
        data: { courtSentAt: null },
      });
    }
  }

  const runningLeft = await prisma.courtQueueItem.count({ where: { firmId, state: 'RUNNING' } });
  const doneCount = await prisma.courtQueueItem.count({ where: { firmId, state: 'DONE' } });

  await audit(AuditAction.COURT_SUBMIT, {
    target: `firm:${firmId}`,
    detail: {
      amal: 'navbat bekor qilindi',
      firma: firm.shortName,
      navbatdanOchirildi: caseIds.length,
      toxtatilganPartiya: stoppedJobs,
      ketayotganTugaydi: runningLeft,
      yuborilganTegilmadi: doneCount,
    },
  });

  return NextResponse.json({
    canceled: caseIds.length,
    stoppedJobs,
    finishing: runningLeft,
    kept: doneCount,
    paused: true,
  });
}
