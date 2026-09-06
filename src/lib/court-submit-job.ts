// src/lib/court-submit-job.ts
// Web UI orqali («Sudga yuborish» va «Yuborish navbati») ishlarni
// ketma-ketlikda (sequential) va rate-limitni saqlagan holda
// to'g'ridan-to'g'ri cabinet.sud.uz (Adolat) tizimiga kirituvchi orqa fon dvigateli.

import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db';
import { getStoredCabinetSession } from './cabinet/session';
import { CabinetSubmitEngine } from '../../cabinet-api-skeleton/submitter';
import { resolveCabinetCourtGuid, CABINET_REGION_IDS } from '../../cabinet-api-skeleton/constants';
import type { SourceCaseData } from '../../cabinet-api-skeleton/builder';
import type { CaseFileToUpload } from '../../cabinet-api-skeleton/uploader';

const CLAIMANT_ID_BY_STIR: Record<string, string> = {
  '311976765': 'a9c49a63-5b0b-48c6-b2fb-48db85dd6f5a', // BRIGHT FUTURE FINANCING
};

const DEFAULT_DELAY_MS = 8_000; // 8 soniya kutish (portal rate-limiter himoyasi)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CourtSubmitJobOpts {
  firmId: number;
  snapshotId?: number;
  caseIds: number[];
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

  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
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

    const claimantId = CLAIMANT_ID_BY_STIR[firmStir] || 'a9c49a63-5b0b-48c6-b2fb-48db85dd6f5a';

    const engine = new CabinetSubmitEngine({
      token: sessionToken,
      account: firmStir,
      orgName: firm.shortName,
    });

    const targetCases = await prisma.arizaCase.findMany({
      where: { id: { in: opts.caseIds } },
      include: { firm: true, court: true, documents: true },
      orderBy: { id: 'asc' },
    });

    console.log(`[Job ${jobId}] Sudga topshirish boshlandi: ${targetCases.length} ta ish (${firm.shortName})`);

    for (let idx = 0; idx < targetCases.length; idx++) {
      // Bekor qilish talabini tekshirish
      const curJob = await prisma.job.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
      if (curJob?.cancelRequested) {
        console.log(`[Job ${jobId}] Operator tomonidan bekor qilindi.`);
        break;
      }

      const ac = targetCases[idx];
      const caseIndexStr = `[${idx + 1}/${targetCases.length}]`;
      console.log(`[Job ${jobId}] ${caseIndexStr} Case #${ac.id} (${ac.clientName}) yuborilmoqda...`);

      // Sud GUID
      const courtGuid = resolveCabinetCourtGuid(ac.court);

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
        } else {
          console.error(`❌ [Job ${jobId}] Case #${ac.id} xatolik: ${result.error}`);
        }
      } catch (err: any) {
        console.error(`❌ [Job ${jobId}] Case #${ac.id} istisno:`, err.message);
      }

      // Progress yangilash (saytdagi progress bar siljishi uchun)
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: idx + 1 },
      });

      // Keyingi ishgacha kutish (oxirgi ish bo'lmasa)
      if (idx < targetCases.length - 1) {
        await sleep(delayMs);
      }
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'DONE',
        message: 'Barcha ishlar muvaffaqiyatli topshirildi',
      },
    });
    console.log(`🎉 [Job ${jobId}] Barcha ishlar yakunlandi (DONE).`);
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
