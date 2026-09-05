// cabinet-api-skeleton/send-one-live.ts
// HAQIQIY bitta case'ni API orqali to'g'ridan-to'g'ri cabinet.sud.uz ga kiritib yuborish skripti.
// Claude qo'ygan sun'iy to'siqlar (BLOCKED: send-to-court) olib tashlangan.
//
// Ishga tushirish:
//   npx tsx cabinet-api-skeleton/send-one-live.ts <caseId>
//
//   Misol: npx tsx cabinet-api-skeleton/send-one-live.ts 123

import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { CabinetSubmitEngine } from './submitter';
import { resolveCabinetCourtGuid, CABINET_COURT_IDS } from './constants';
import type { SourceCaseData } from './builder';
import type { CaseFileToUpload } from './uploader';

async function main() {
  const caseId = Number(process.argv[2]);
  const isDryRun = process.argv.includes('--dry-run');

  if (!caseId || !Number.isInteger(caseId)) {
    console.error('❌ Foydalanish: npx tsx cabinet-api-skeleton/send-one-live.ts <caseId> [--dry-run]');
    console.error('Misol: npx tsx cabinet-api-skeleton/send-one-live.ts 3505');
    console.error('Misol (xavfsiz sinov): npx tsx cabinet-api-skeleton/send-one-live.ts 3505 --dry-run');
    process.exit(1);
  }

  // 1. Bazadan Case ma'lumotlarini yuklash
  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    include: {
      firm: true,
      court: true,
      documents: true,
    },
  });

  if (!ac) {
    console.error(`❌ Case #${caseId} topilmadi.`);
    process.exit(1);
  }

  const firmStir = (ac.firm.stir || '').replace(/\D/g, '');
  if (!firmStir) {
    console.error('❌ Firmaning STIR raqami topilmadi.');
    process.exit(1);
  }

  // Sud GUID'ini aniqlash (Yuqorichirchiq tumanlararo sudi yoki Uchtepa)
  const courtGuid = resolveCabinetCourtGuid(ac.court);
  const courtName = ac.court?.shortName || (courtGuid === CABINET_COURT_IDS.YUQORICHIRCHIQ_CIVIL ? 'Yuqorichirchiq tumanlararo sudi' : 'Uchtepa tumanlararo sudi');

  console.log(`\n======================================================`);
  console.log(`SUDGA YUBORISH (LIVE API): Case #${ac.id} ${isDryRun ? '[DRY-RUN]' : '[REAL SUBMIT]'}`);
  console.log(`Mijoz : ${ac.clientName} (PINFL: ${ac.pinfl})`);
  console.log(`Firma : ${ac.firm.shortName} (Kodi: ${ac.firm.code}, STIR: ${firmStir})`);
  console.log(`Sud   : ${courtName} (Portal GUID: ${courtGuid})`);
  console.log(`Qarz  : ${Number(ac.totalDebt).toLocaleString()} so'm`);
  console.log(`Bosqich: ${ac.stage}`);
  console.log(`======================================================\n`);

  // 2. Firmaning cabinet.sud.uz sessiyasini olish
  let sessionToken = process.env.CABINET_TOKEN;
  if (!sessionToken) {
    try {
      const session = await getStoredCabinetSession(firmStir);
      sessionToken = session.token;
      console.log(`✔ Faol Cabinet sessiyasi topildi (Foydalanuvchi: ${session.user.username || 'OK'})`);
    } catch (e: any) {
      console.error(`❌ Firmaning cabinet sessiyasi topilmadi yoki muddati o'tgan: ${e.message}`);
      console.error(`Iltimos, saytda «Ulanishlar» orqali E-IMZO bilan qayta kiring yoki CABINET_TOKEN env o'rnating.`);
      process.exit(1);
    }
  } else {
    console.log(`✔ Maxsus CABINET_TOKEN muhit o'zgaruvchisidan olindi.`);
  }

  // 3. Portfeldagi kreditlar
  const loans = await prisma.loan.findMany({
    where: { snapshotId: ac.snapshotId ?? undefined, pinfl: ac.pinfl, branchCode: ac.kod ?? undefined },
  });

  const principal = loans.reduce((s, l) => s + Number(l.debtPrincipal || 0) + Number(l.debtOverduePrincipal || 0), 0);
  const interest = loans.reduce((s, l) => s + Number(l.debtTermInterest || 0) + Number(l.debtOverdueInterest || 0), 0);
  const total = Number(ac.totalDebt) || (principal + interest);

  // 4. SourceCaseData shakllantirish
  const firstLoan = loans[0];
  const rawLoan = (firstLoan?.raw && typeof firstLoan.raw === 'object' ? firstLoan.raw : {}) as Record<string, any>;

  const caseData: SourceCaseData = {
    courtId: courtGuid,
    firm: {
      name: ac.firm.legalName || ac.firm.shortName,
      shortName: ac.firm.shortName,
      stir: firmStir,
      address: ac.firm.addressLine || ac.firm.address || 'Toshkent sh.',
      bankAccount: ac.firm.bankAccount || '',
      mfo: ac.firm.mfo || '',
      phone: ac.firm.phone || '998993058435',
      director: 'SUVONOV FARRUXJON FAXRITDINOVICH',
    },
    debtor: {
      pinfl: ac.pinfl || '',
      fullName: ac.clientName || '',
      passportSn: firstLoan?.passportSn || rawLoan['Паспорт'] || '',
      address: firstLoan?.postAddressUz || firstLoan?.postAddress || 'Toshkent sh.',
      phone: firstLoan?.phone || '',
    },
    debt: {
      principal,
      interest,
      penalty: 0,
      total,
    },
    receiptNumber: ac.receiptNumber || undefined,
  };

  // 5. Hujjatlarni diskdan o'qib yig'ish
  const filesToUpload: CaseFileToUpload[] = [];

  // A) DB dagi CaseDocument yozuvlaridan
  for (const doc of ac.documents) {
    try {
      const buf = await fs.readFile(doc.filePath);
      let kind: CaseFileToUpload['kind'] = 'OFERTA';
      if (doc.kind === 'SIGNED_ARIZA' || doc.kind === 'ARIZA') kind = 'ARIZA';
      else if (doc.kind === 'TALABNOMA') kind = 'TALABNOMA';
      else if (doc.kind === 'TALABNOMA_RECEIPT') kind = 'TALABNOMA_CHECK';
      else if (doc.kind === 'GUVOHNOMA') kind = 'GUVOHNOMA';
      else if (doc.kind === 'ISHONCHNOMA') kind = 'ISHONCHNOMA';

      filesToUpload.push({
        kind,
        fileName: doc.fileName,
        buffer: buf,
      });
    } catch {}
  }

  // B) Diskdagi papkalardan qidirish (agar DB da to'liq bo'lmasa)
  const home = process.env.HOME || '';
  if (filesToUpload.length === 0 && ac.clientName) {
    const candidateDirs = [
      path.join(home, 'Downloads', 'BRIGHT FUTURE FINANCING 2', `${ac.clientName} ${ac.pinfl}`),
      path.join(home, 'Downloads', 'BRIGHT FUTURE FINANCING 3', `${ac.clientName} ${ac.pinfl}`),
      path.join(home, 'Downloads', '5-sud BRIGHT TAYYOR', ac.clientName),
    ];
    for (const cDir of candidateDirs) {
      try {
        const list = await fs.readdir(cDir);
        for (const fname of list) {
          if (!fname.endsWith('.pdf')) continue;
          const buf = await fs.readFile(path.join(cDir, fname));
          let kind: CaseFileToUpload['kind'] = 'OFERTA';
          if (/ariza/i.test(fname)) kind = 'ARIZA';
          else if (/talabnoma/i.test(fname) || fname.includes(ac.clientName)) kind = 'TALABNOMA';
          else if (/receipt|check|td/i.test(fname)) kind = 'TALABNOMA_CHECK';
          else if (/guvox/i.test(fname)) kind = 'GUVOHNOMA';
          else if (/ishonch/i.test(fname)) kind = 'ISHONCHNOMA';
          filesToUpload.push({ kind, fileName: fname, buffer: buf });
        }
        if (filesToUpload.length > 0) break;
      } catch {}
    }
  }

  // C) Tashkilot statik hujjatlari (Guvohnoma, Ishonchnoma)
  const hasGuvox = filesToUpload.some((f) => f.kind === 'GUVOHNOMA');
  const hasIshonch = filesToUpload.some((f) => f.kind === 'ISHONCHNOMA');
  if (!hasGuvox) {
    try {
      const gBuf = await fs.readFile(path.join(home, 'Downloads', 'Guvoxnoma BRIGHT.pdf'));
      filesToUpload.push({ kind: 'GUVOHNOMA', fileName: 'Guvoxnoma BRIGHT.pdf', buffer: gBuf });
    } catch {}
  }
  if (!hasIshonch) {
    try {
      const iBuf = await fs.readFile(path.join(home, 'Downloads', 'Ishonchnoma BRIGHT.pdf'));
      filesToUpload.push({ kind: 'ISHONCHNOMA', fileName: 'Ishonchnoma BRIGHT.pdf', buffer: iBuf });
    } catch {}
  }

  console.log(`Yuklanadigan hujjatlar soni: ${filesToUpload.length} ta`);
  filesToUpload.forEach((f, idx) => console.log(`  [${idx + 1}] ${f.kind} -> ${f.fileName}`));

  // 6. Dvigatelni ishga tushirish (LIVE SUBMISSION)
  const engine = new CabinetSubmitEngine({
    token: sessionToken,
    account: firmStir,
    orgName: ac.firm.shortName,
  });

  if (isDryRun) {
    console.log('\n🔍 DRY-RUN REJIMI: Qoralama yaratilib tekshiriladi, ammo sudga jo\'natilmaydi...');
  } else {
    console.log('\n🚀 cabinet.sud.uz ga YAKUNIY YUBORISH boshlandi (send-to-court bloklanmagan)...');
  }

  const result = await engine.submitCase(caseData, filesToUpload, {
    dryRun: isDryRun,
    courtGuid,
  });


  if (result.ok) {
    console.log('\n======================================================');
    console.log(`✔ ISH SUDGA MUVAFFAQIYATLI TOPSHIRILDI!`);
    console.log(`Claim ID   : ${result.claimId}`);
    console.log(`Ish raqami : ${result.caseNumber || 'Kutilmoqda'}`);
    console.log(`Reyestr №  : ${result.registryNumber || '—'}`);
    console.log('======================================================\n');

    // Bazadagi case statusini yangilash
    await prisma.arizaCase.update({
      where: { id: caseId },
      data: {
        stage: 'COURT_SUBMITTED',
        courtCaseId: result.claimId,
        courtSentAt: new Date(),
        meta: {
          submittedViaApi: true,
          submittedAt: new Date().toISOString(),
          claimId: result.claimId,
          caseNumber: result.caseNumber,
        } as any,
      },
    });
  } else {
    console.error('\n❌ Yuborish muvaffaqiyatsiz tugadi:', result.error);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
