// src/lib/court-submit-job.ts
// Web UI orqali («Sudga yuborish» va «Yuborish navbati») ishlarni
// ketma-ketlikda (sequential) va rate-limitni saqlagan holda
// to'g'ridan-to'g'ri cabinet.sud.uz (Adolat) tizimiga kirituvchi orqa fon dvigateli.

import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db';
import { getStoredCabinetSession } from './cabinet/session';
import { CabinetSubmitEngine } from '../../cabinet-api-skeleton/submitter';
import { CabinetRequestError } from '../../cabinet-api-skeleton/client';
import { paceCase, backoff, caseGapFor, REQUEST_GAP_MS, CASE_GAP_MS } from './cabinet/pacer';
import { audit, AuditAction } from './audit';
import { resolveCabinetCourtGuid, CABINET_REGION_IDS } from '../../cabinet-api-skeleton/constants';
import type { SourceCaseData } from '../../cabinet-api-skeleton/builder';
import type { CaseFileToUpload } from '../../cabinet-api-skeleton/uploader';

// Har firmaning cabinet.sud.uz akkaunti O'ZINING ORGANIZATION claimant GUID'iga ega — bu
// da'voni KIM nomidan ochilishini belgilaydi. Noto'g'ri GUID = boshqa firma nomidan da'vo
// (kreditor bo'lmagan yuridik shaxs sudga chiqadi) — qaytarib bo'lmaydigan xato.
//
// Yangi firma qo'shish: o'sha firma kaliti bilan ADOLAT'ga kirib, yangi qoralama yarating va
// birinchi PUT javobidagi `details.createApplication.claimant` qiymatini shu yerga yozing.
const CLAIMANT_ID_BY_STIR: Record<string, string> = {
  '311976765': 'a9c49a63-5b0b-48c6-b2fb-48db85dd6f5a', // BRIGHT FUTURE FINANCING
};

/** Firma STIR'i bo'yicha claimant GUID. Topilmasa — ATAYIN xato tashlaydi: jim fallback
 *  (avval BRIGHT'nikiga tushib ketardi) qolgan 8 firma uchun boshqa firma nomidan da'vo
 *  ochib yuborardi. Yo'qligi bilinib turgani — noto'g'ri da'vodan ko'ra ancha yaxshi. */
function claimantIdFor(firmStir: string, firmName: string): string {
  const id = CLAIMANT_ID_BY_STIR[firmStir];
  if (!id) {
    throw new Error(
      `${firmName} (STIR ${firmStir}) uchun ADOLAT claimant GUID topilmadi. ` +
      `Bu firma nomidan da'vo ocholmaymiz — CLAIMANT_ID_BY_STIR'ga qo'shing (src/lib/court-submit-job.ts).`,
    );
  }
  return id;
}

// Worker jarayonida so'rov konteksti yo'q — currentUser() yiqiladi va audit JIM yozilmay
// qoladi. Shuning uchun aktyor aniq beriladi: navbat tizim nomidan ishlaydi.
const QUEUE_ACTOR = { username: 'tizim (sud navbati)', role: 'system' };

// Tezlik endi src/lib/cabinet/pacer.ts da — GLOBAL (barcha firma navbatlari uchun bitta) va
// SO'ROV darajasida. Eski DEFAULT_DELAY_MS faqat case'lar orasida 8s kutardi, bitta case
// ichidagi ~7 so'rov esa bir zumda otilardi — aynan shu naqsh 2026-09-06 da bloklangan.

export interface CourtSubmitJobOpts {
  firmId: number;
  snapshotId?: number;
  caseIds: number[];
  /** @deprecated Tezlik endi pacer.ts da global belgilanadi; bu maydon e'tiborga olinmaydi. */
  delayMs?: number;
  dryRun?: boolean;
}

/**
 * Har bir ish uchun diskdagi hujjatlarni yig'ish
 */
async function collectCaseFiles(ac: any): Promise<CaseFileToUpload[]> {
  const filesToUpload: CaseFileToUpload[] = [];

  // A) DB dagi CaseDocument yozuvlaridan
  for (const doc of ac.documents || []) {
    try {
      let fPath = doc.filePath;
      if (fPath.startsWith('/app/')) {
        fPath = path.join(process.cwd(), fPath.replace(/^\/app\//, ''));
      }
      const buf = await fs.readFile(fPath);
      let kind: CaseFileToUpload['kind'] = 'OFERTA';
      if (doc.kind === 'SIGNED_ARIZA' || doc.kind === 'ARIZA') kind = 'ARIZA';
      else if (doc.kind === 'TALABNOMA') kind = 'TALABNOMA';
      else if (doc.kind === 'TALABNOMA_RECEIPT') kind = 'TALABNOMA_CHECK';
      else if (doc.kind === 'GUVOHNOMA') kind = 'GUVOHNOMA';
      else if (doc.kind === 'ISHONCHNOMA') kind = 'ISHONCHNOMA';

      filesToUpload.push({ kind, fileName: doc.fileName, buffer: buf });
    } catch {}
  }

  // B) Diskdagi papkalardan qidirish (Oferta va boshqa ilovalar)
  const home = process.env.HOME || '';
  if (ac.clientName) {
    const candidateDirs = [
      path.join(home, 'Downloads', 'BRIGHT FUTURE FINANCING 3', `${ac.clientName} ${ac.pinfl}`),
      path.join(home, 'Downloads', 'BRIGHT FUTURE FINANCING 2', `${ac.clientName} ${ac.pinfl}`),
      path.join(home, 'Downloads', '5-sud BRIGHT TAYYOR', ac.clientName),
    ];
    for (const cDir of candidateDirs) {
      try {
        const list = await fs.readdir(cDir);
        for (const fname of list) {
          if (!fname.endsWith('.pdf')) continue;
          if (filesToUpload.some((f) => f.fileName === fname)) continue;
          const buf = await fs.readFile(path.join(cDir, fname));
          let kind: CaseFileToUpload['kind'] = 'OFERTA';
          if (/ariza/i.test(fname)) kind = 'ARIZA';
          else if (/talabnoma/i.test(fname)) kind = 'TALABNOMA';
          else if (/receipt|check|td/i.test(fname)) kind = 'TALABNOMA_CHECK';
          else if (/guvox/i.test(fname)) kind = 'GUVOHNOMA';
          else if (/ishonch/i.test(fname)) kind = 'ISHONCHNOMA';
          filesToUpload.push({ kind, fileName: fname, buffer: buf });
        }
        if (filesToUpload.length > 1) break;
      } catch {}
    }
  }

  // C) Tashkilot statik hujjatlari (Guvohnoma, Ishonchnoma)
  const hasGuvox = filesToUpload.some((f) => f.kind === 'GUVOHNOMA');
  const hasIshonch = filesToUpload.some((f) => f.kind === 'ISHONCHNOMA');
  if (!hasGuvox) {
    const paths = [
      path.join(process.cwd(), 'exports', 'firm-docs', String(ac.firmId), 'GUVOHNOMA-Guvoxnoma_BRIGHT.pdf'),
      path.join(home, 'Downloads', 'Guvoxnoma BRIGHT.pdf'),
    ];
    for (const p of paths) {
      try {
        const gBuf = await fs.readFile(p);
        filesToUpload.push({ kind: 'GUVOHNOMA', fileName: 'Guvoxnoma BRIGHT.pdf', buffer: gBuf });
        break;
      } catch {}
    }
  }
  if (!hasIshonch) {
    const paths = [
      path.join(process.cwd(), 'exports', 'firm-docs', String(ac.firmId), 'ISHONCHNOMA-Ishonchnoma_BRIGHT.pdf'),
      path.join(home, 'Downloads', 'Ishonchnoma BRIGHT.pdf'),
    ];
    for (const p of paths) {
      try {
        const iBuf = await fs.readFile(p);
        filesToUpload.push({ kind: 'ISHONCHNOMA', fileName: 'Ishonchnoma BRIGHT.pdf', buffer: iBuf });
        break;
      } catch {}
    }
  }

  return filesToUpload;
}

/**
 * 100 talab ishlarni ketma-ketlikda cabinet.sud.uz ga kiritish fon xizmati
 */
export async function runCourtSubmitJob(jobId: number, opts: CourtSubmitJobOpts): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });

  const isDryRun = opts.dryRun === true;

  try {
    const firm = await prisma.firm.findUnique({
      where: { id: opts.firmId },
      select: { id: true, shortName: true, stir: true },
    });
    if (!firm) {
      throw new Error(`Firma topilmadi: id=${opts.firmId}`);
    }

    const firmStir = (firm.stir || '').replace(/\D/g, '');
    if (!firmStir) {
      throw new Error(`Firmada STIR yo'q: ${firm.shortName}`);
    }

    // Cabinet sessiyasini olish
    let sessionToken = process.env.CABINET_TOKEN;
    if (!sessionToken) {
      const sess = await getStoredCabinetSession(firmStir);
      sessionToken = sess.token;
    }

    const claimantId = claimantIdFor(firmStir, firm.shortName);

    const engine = new CabinetSubmitEngine({
      token: sessionToken,
      account: firmStir,
      orgName: firm.shortName,
    });

    // IDEMPOTENTLIK: allaqachon DONE bo'lgan case qayta yuborilmaydi. Bitta odamga ikkita
    // da'vo ochilishi — qaytarib bo'lmaydigan xato, shuning uchun bu filtr eng muhimi.
    const already = await prisma.courtQueueItem.findMany({
      where: { caseId: { in: opts.caseIds }, state: 'DONE' },
      select: { caseId: true },
    });
    const doneIds = new Set(already.map((q) => q.caseId));
    const pendingIds = opts.caseIds.filter((id) => !doneIds.has(id));
    if (doneIds.size > 0) {
      console.log(`[Job ${jobId}] ${doneIds.size} ta ish allaqachon yuborilgan — o'tkazib yuborildi.`);
    }

    const targetCases = await prisma.arizaCase.findMany({
      where: { id: { in: pendingIds } },
      include: { firm: true, court: true, documents: true },
      orderBy: { id: 'asc' },
    });

    // Navbat yozuvlarini tayyorlash: har case PENDING holatida ko'rinadi (operator darhol
    // "navbatda" deb ko'radi, ish boshlanishini kutmasdan).
    for (const ac of targetCases) {
      await prisma.courtQueueItem.upsert({
        where: { caseId: ac.id },
        create: { caseId: ac.id, firmId: firm.id, account: firmStir, state: 'PENDING', jobId },
        update: { state: 'PENDING', jobId, lastError: null, finishedAt: null },
      });
    }

    console.log(`[Job ${jobId}] Sudga topshirish boshlandi: ${targetCases.length} ta ish (${firm.shortName})`);
    console.log(`[Job ${jobId}] Tezlik: har so'rov orasida ${REQUEST_GAP_MS / 1000}s, ishlar orasida sud sozlamasi bo'yicha (default ${CASE_GAP_MS / 1000}s)`);

    let okCount = 0;
    let failCount = 0;
    let stopReason: string | null = null;

    for (let idx = 0; idx < targetCases.length; idx++) {
      // Bekor qilish talabini tekshirish
      const curJob = await prisma.job.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
      if (curJob?.cancelRequested) {
        console.log(`[Job ${jobId}] Operator tomonidan bekor qilindi.`);
        stopReason = 'Operator bekor qildi';
        break;
      }

      const ac = targetCases[idx];
      const caseIndexStr = `[${idx + 1}/${targetCases.length}]`;

      // TEZLIK: interval SHU ISHNING SUDI yozuvidan olinadi (Sudlar bo'limida sozlanadi,
      // default 60s). Birinchi ish kutmaydi — pacer oxirgi ish vaqtidan hisoblaydi.
      const gapMs = caseGapFor((ac.court as { sendIntervalSec?: number } | null)?.sendIntervalSec);
      await paceCase(gapMs, (msLeft) => {
        console.log(`[Job ${jobId}] ${caseIndexStr} navbat: ${Math.ceil(msLeft / 1000)}s kutilmoqda...`);
      });

      console.log(`[Job ${jobId}] ${caseIndexStr} Case #${ac.id} (${ac.clientName}) yuborilmoqda...`);
      await prisma.courtQueueItem.update({
        where: { caseId: ac.id },
        data: { state: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
      });

      // Sud GUID. Sud tanilmasa (yoki umuman belgilanmagan bo'lsa) resolveCabinetCourtGuid
      // xato tashlaydi — bu FAQAT shu ishni yiqitishi kerak, butun partiyani emas.
      let courtGuid: string;
      try {
        courtGuid = resolveCabinetCourtGuid(ac.court);
      } catch (e: any) {
        failCount++;
        const msg = String(e?.message || e);
        console.error(`❌ [Job ${jobId}] Case #${ac.id} sud aniqlanmadi: ${msg}`);
        await prisma.courtQueueItem.update({
          where: { caseId: ac.id },
          data: { state: 'FAILED', finishedAt: new Date(), lastError: msg.slice(0, 2000) },
        });
        await audit(AuditAction.COURT_SUBMIT, {
          actor: QUEUE_ACTOR,
          target: `case:${ac.id}`,
          detail: { natija: 'YUBORILMADI', firma: firm.shortName, mijoz: ac.clientName, xato: msg.slice(0, 500), jobId },
        });
        continue;
      }

      // Kreditlar
      let loans = await prisma.loan.findMany({
        where: { snapshotId: ac.snapshotId ?? undefined, pinfl: ac.pinfl, branchCode: ac.kod ?? undefined },
      });
      if (loans.length === 0) {
        loans = await prisma.loan.findMany({ where: { pinfl: ac.pinfl, branchCode: ac.kod ?? undefined } });
      }
      if (loans.length === 0) {
        loans = await prisma.loan.findMany({ where: { pinfl: ac.pinfl } });
      }

      const principal = loans.reduce((s, l) => s + Number(l.debtPrincipal || 0) + Number(l.debtOverduePrincipal || 0), 0);
      const interest = loans.reduce((s, l) => s + Number(l.debtTermInterest || 0) + Number(l.debtOverdueInterest || 0), 0);
      const total = Number(ac.totalDebt) || (principal + interest);

      const firstLoan = loans[0];
      const rawLoan = (firstLoan?.raw && typeof firstLoan.raw === 'object' ? firstLoan.raw : {}) as Record<string, any>;
      const passportSn: string = firstLoan?.passportSn || rawLoan['Паспорт'] || '';
      const passportClean = passportSn.replace(/\s+/g, '').toUpperCase();

      const caseData: SourceCaseData = {
        courtId: courtGuid,
        regionId: CABINET_REGION_IDS.TOSHKENT_VILOYATI,
        claimantId,
        firm: { stir: firmStir },
        debtor: {
          pinfl: ac.pinfl || '',
          fullName: ac.clientName || '',
          passportSerial: passportClean.slice(0, 2) || undefined,
          passportNumber: passportClean.slice(2) || undefined,
          phone: firstLoan?.phone || undefined,
          gender: undefined,
          address: firstLoan?.postAddressUz || firstLoan?.postAddress || undefined,
        },
        debt: {
          principal, interest, penalty: 0, fine: 0,
          moralDamage: 0, materialDamage: 0, lostProfit: 0, prepaidExpense: 0,
          total,
        },
      };

      try {
        const filesToUpload = await collectCaseFiles(ac);
        const result = await engine.submitCase(caseData, filesToUpload, { dryRun: isDryRun });

        if (result.ok && !isDryRun) {
          await prisma.arizaCase.update({
            where: { id: ac.id },
            data: {
              stage: 'COURT_SUBMITTED',
              stageEnteredAt: new Date(),
              courtSentAt: new Date(),
              courtCaseId: result.caseNumber || result.registryNumber || result.draftId,
              meta: {
                ...((ac.meta as any) || {}),
                exportedAt: new Date().toISOString(),
                cabinetDraftId: result.draftId,
                cabinetSubmittedAt: new Date().toISOString(),
                caseNumber: result.caseNumber,
                registryNumber: result.registryNumber,
              },
            },
          });
          console.log(`✔ [Job ${jobId}] Case #${ac.id} topshirildi! Ish raqami: ${result.caseNumber || result.draftId}`);
        } else if (result.ok && isDryRun) {
          console.log(`✔ [Job ${jobId}] Case #${ac.id} DRY-RUN muvaffaqiyatli!`);
        }

        if (result.ok) {
          okCount++;
          await prisma.courtQueueItem.update({
            where: { caseId: ac.id },
            data: {
              state: 'DONE', finishedAt: new Date(), lastError: null,
              draftId: result.draftId ?? null, caseNumber: result.caseNumber ?? null,
            },
          });
          // DOIMIY TARIX: navbat yozuvi qayta urinishda ustiga yoziladi, bu esa qoladi.
          await audit(AuditAction.COURT_SUBMIT, {
            actor: QUEUE_ACTOR,
            target: `case:${ac.id}`,
            detail: {
              natija: isDryRun ? 'DRY-RUN' : 'yuborildi', firma: firm.shortName, mijoz: ac.clientName,
              pinfl: ac.pinfl, sud: ac.court?.shortName ?? null, summa: String(ac.totalDebt),
              ishRaqami: result.caseNumber ?? null, draftId: result.draftId ?? null, jobId,
            },
          });
        } else {
          failCount++;
          console.error(`❌ [Job ${jobId}] Case #${ac.id} xatolik: ${result.error}`);
          await prisma.courtQueueItem.update({
            where: { caseId: ac.id },
            data: {
              state: 'FAILED', finishedAt: new Date(),
              lastError: result.error ?? 'Nomaʼlum xato', draftId: result.draftId ?? null,
            },
          });
          await audit(AuditAction.COURT_SUBMIT, {
            actor: QUEUE_ACTOR,
            target: `case:${ac.id}`,
            detail: {
              natija: 'YUBORILMADI', firma: firm.shortName, mijoz: ac.clientName, pinfl: ac.pinfl,
              xato: result.error ?? 'Nomaʼlum xato', draftId: result.draftId ?? null, jobId,
            },
          });
        }
      } catch (err: any) {
        failCount++;
        console.error(`❌ [Job ${jobId}] Case #${ac.id} istisno:`, err.message);
        await prisma.courtQueueItem.update({
          where: { caseId: ac.id },
          data: { state: 'FAILED', finishedAt: new Date(), lastError: String(err?.message || err).slice(0, 2000) },
        });
        await audit(AuditAction.COURT_SUBMIT, {
          actor: QUEUE_ACTOR,
          target: `case:${ac.id}`,
          detail: {
            natija: 'YUBORILMADI', firma: firm.shortName, mijoz: ac.clientName, pinfl: ac.pinfl,
            xato: String(err?.message || err).slice(0, 500),
            turi: err instanceof CabinetRequestError ? err.kind : 'ISTISNO', jobId,
          },
        });

        // CIRCUIT BREAKER: sessiya o'lgan yoki portal bloklagan bo'lsa — qolgan ishlarni
        // urinib ko'rish mantiqsiz (hammasi bir xil yiqiladi) va blokni yomonlashtiradi.
        // Navbat to'xtaydi, qolganlar PENDING bo'lib qoladi — operator sababni tuzatib,
        // qaytadan bosadi va aynan shu joydan davom etadi.
        if (err instanceof CabinetRequestError && err.stopsQueue) {
          if (err.kind === 'RATE_LIMIT' || err.kind === 'BLOCKED') backoff(15 * 60_000);
          stopReason = err.kind === 'AUTH'
            ? 'Cabinet sessiyasi tugagan — E-IMZO bilan qayta imzolang, so\'ng davom eting'
            : `Portal javob bermayapti (${err.kind}) — navbat to'xtatildi, keyinroq davom eting`;
          console.error(`⛔ [Job ${jobId}] Navbat to'xtatildi: ${stopReason}`);
          break;
        }
      }

      // Progress + oraliq hisobot. Progress har ishdan keyin yoziladi — bu ayni paytda
      // worker'ning "tirikman" belgisi ham (orphan sweep Job.updatedAt'ga qaraydi va
      // 15 daqiqa qimirlamagan RUNNING job'ni o'lik deb belgilaydi; biz har ~60s yozamiz).
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: idx + 1, message: `${okCount} ta yuborildi, ${failCount} ta xato` },
      });
    }

    // Qolgan (umuman urinilmagan) ishlar PENDING bo'lib qoladi — operator qaytadan bosса
    // aynan shulardan davom etadi.
    const leftover = await prisma.courtQueueItem.count({ where: { jobId, state: { in: ['PENDING', 'RUNNING'] } } });

    // HALOL YAKUN: avval xato bo'lsa ham "Barcha ishlar muvaffaqiyatli topshirildi" deb
    // yozilardi — operator 100 ta ish ketdi deb o'ylab, aslida hech biri ketmagan bo'lishi
    // mumkin edi. Endi holat aniq raqamlar bilan ko'rinadi.
    const parts = [`${okCount} ta yuborildi`];
    if (failCount > 0) parts.push(`${failCount} ta XATO`);
    if (doneIds.size > 0) parts.push(`${doneIds.size} ta avval yuborilgan (o'tkazildi)`);
    if (leftover > 0) parts.push(`${leftover} ta navbatda qoldi`);
    if (stopReason) parts.push(`— ${stopReason}`);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        // Bironta ish ketmagan bo'lsa bu muvaffaqiyat emas — FAILED deb ko'rsatiladi.
        status: okCount === 0 && failCount > 0 ? 'FAILED' : 'DONE',
        message: parts.join(', '),
      },
    });
    // Partiya yakuni — /jurnal'da bitta qatorda ko'rinadi (kim, qachon, qancha, natija).
    await audit(AuditAction.COURT_SUBMIT, {
      actor: QUEUE_ACTOR,
      target: `firm:${firm.id}`,
      detail: {
        natija: 'partiya yakunlandi', firma: firm.shortName, jobId,
        yuborildi: okCount, xato: failCount, avvalYuborilgan: doneIds.size,
        navbatdaQoldi: leftover, toxtashSababi: stopReason, dryRun: isDryRun,
      },
    });
    console.log(`🎉 [Job ${jobId}] Yakun: ${parts.join(', ')}`);
  } catch (fatal: any) {
    console.error(`❌ [Job ${jobId}] Bosh xatolik:`, fatal.message);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        message: fatal.message,
      },
    });
  }
}
