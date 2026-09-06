// cabinet-api-skeleton/send-one-live.ts
// HAQIQIY bitta case'ni API orqali to'g'ridan-to'g'ri cabinet.sud.uz ga kiritib yuborish skripti.
// Claude qo'ygan sun'iy to'siqlar (BLOCKED: send-to-court) olib tashlangan.
//
// Ishga tushirish:
//   npx tsx cabinet-api-skeleton/send-one-live.ts <caseId>
//
//   Misol: npx tsx cabinet-api-skeleton/send-one-live.ts 123

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { prisma } from '../src/lib/db';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { CabinetSubmitEngine } from './submitter';
import { collectCaseFiles } from '../src/lib/court-submit-job';
import { resolveCabinetCourtGuid, CABINET_COURT_IDS, CABINET_REGION_IDS } from './constants';
import type { SourceCaseData } from './builder';
import type { CaseFileToUpload } from './uploader';

// TODO(claimant-lookup): har firmaning cabinet.sud.uz akkaunti O'ZINING bitta ORGANIZATION
// claimant GUID'iga ega (E-IMZO kaliti bilan kirilganda "Da'vogar nomi" shu firmaga avtomatik
// tushadi — 2026-09-06 browserda tasdiqlangan). Hozircha faqat BRIGHT uchun bitta marta qo'lda
// aniqlangan (yangi draft yaratib, birinchi javobdagi details.createApplication.claimant'ni
// o'qib). Boshqa firmalar (URBAN/COMMUNITY/...) uchun xuddi shu usulda topib shu yerga qo'shing.
const CLAIMANT_ID_BY_STIR: Record<string, string> = {
  '311976765': 'a9c49a63-5b0b-48c6-b2fb-48db85dd6f5a', // BRIGHT FUTURE FINANCING
};

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
  let loans = await prisma.loan.findMany({
    where: { snapshotId: ac.snapshotId ?? undefined, pinfl: ac.pinfl, branchCode: ac.kod ?? undefined },
  });
  if (loans.length === 0) {
    loans = await prisma.loan.findMany({
      where: { pinfl: ac.pinfl, branchCode: ac.kod ?? undefined },
    });
  }
  if (loans.length === 0) {
    loans = await prisma.loan.findMany({
      where: { pinfl: ac.pinfl },
    });
  }

  const principal = loans.reduce((s, l) => s + Number(l.debtPrincipal || 0) + Number(l.debtOverduePrincipal || 0), 0);
  const interest = loans.reduce((s, l) => s + Number(l.debtTermInterest || 0) + Number(l.debtOverdueInterest || 0), 0);
  const total = Number(ac.totalDebt) || (principal + interest);

  // 4. SourceCaseData shakllantirish (2026-09-06 tasdiqlangan haqiqiy shakl)
  const firstLoan = loans[0];
  const rawLoan = (firstLoan?.raw && typeof firstLoan.raw === 'object' ? firstLoan.raw : {}) as Record<string, any>;
  const passportSn: string = firstLoan?.passportSn || rawLoan['Паспорт'] || '';
  const passportClean = passportSn.replace(/\s+/g, '').toUpperCase();

  const claimantId = CLAIMANT_ID_BY_STIR[firmStir];
  if (!claimantId) {
    console.error(`❌ ${ac.firm.shortName} (STIR ${firmStir}) uchun claimantId topilmadi. CLAIMANT_ID_BY_STIR'ga qo'shing (izohga qarang).`);
    process.exit(1);
  }

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
      // TODO(gender-from-portfolio): Loan/rawLoan'da jinsi ustuni bo'lsa shu yerdan olinsin.
      gender: undefined,
      address: firstLoan?.postAddressUz || firstLoan?.postAddress || undefined,
    },
    debt: {
      principal, interest, penalty: 0, fine: 0,
      moralDamage: 0, materialDamage: 0, lostProfit: 0, prepaidExpense: 0,
      total,
    },
  };

  // 5. Hujjatlarni yig'ish — sayt/worker bilan BIR XIL mantiq orqali.
  //
  // Avval bu yerda collectCaseFiles ning to'liq NUSXASI turardi va ular vaqt o'tib bir-biridan
  // uzoqlashdi: firma hujjatlari (guvohnoma/ishonchnoma/shartnoma) tuzatilganda skript eski
  // nusxada qolib ketardi, ya'ni skript orqali qilingan sinovlar saytdagi haqiqiy paketni
  // aks ettirmasdi. Endi yagona manba — src/lib/court-submit-job.ts.
  const filesToUpload: CaseFileToUpload[] = await collectCaseFiles(ac);

  console.log(`Yuklanadigan hujjatlar soni: ${filesToUpload.length} ta`);
  filesToUpload.forEach((f, idx) => console.log(`  [${idx + 1}] ${f.kind} -> ${f.fileName}`));

  // 6. Dvigatelni ishga tushirish (LIVE SUBMISSION)
  const engine = new CabinetSubmitEngine({
    token: sessionToken,
    account: firmStir,
    orgName: ac.firm.shortName,
  });

  console.log(isDryRun
    ? '\n🔍 DRY-RUN: qoralama yaratilib to\'ldiriladi, TEKSHIRILADI, so\'ng O\'CHIRILADI. Sudga yuborilmaydi.'
    : '\n🚀 cabinet.sud.uz ga YAKUNIY YUBORISH boshlandi (send-to-court faol)...');

  const result = await engine.submitCase(caseData, filesToUpload, { dryRun: isDryRun });

  if (result.ok) {
    console.log('\n======================================================');
    if (isDryRun) {
      console.log(`✔ DRY-RUN MUVAFFAQIYATLI YAKUNLANDI. draftId=${result.draftId}`);
      console.log('Sinov qoralamasi o\'chirildi — bazada hech narsa o\'zgarmadi.');
    } else {
      console.log(`🎉 SUDGA TOPSHIRILDI! draftId=${result.draftId}`);
      console.log(`Sud ish raqami: ${result.caseNumber || 'YUBORILDI'}`);
      if (result.registryNumber) console.log(`Reestr raqami : ${result.registryNumber}`);

      // Bazada ish holatini COURT_SUBMITTED ga o'tkazish
      await prisma.arizaCase.update({
        where: { id: ac.id },
        data: {
          stage: 'COURT_SUBMITTED',
          stageEnteredAt: new Date(),
          courtSentAt: new Date(),
          courtCaseId: result.caseNumber || result.registryNumber || result.draftId,
          meta: {
            ...((ac.meta as any) || {}),
            cabinetDraftId: result.draftId,
            cabinetSubmittedAt: new Date().toISOString(),
            caseNumber: result.caseNumber,
            registryNumber: result.registryNumber,
          },
        },
      });
      console.log(`✔ Baza yangilandi: Case #${ac.id} holati COURT_SUBMITTED ga o'tkazildi.`);
    }
    console.log('======================================================\n');
  } else {
    console.error('\n❌ Muvaffaqiyatsiz tugadi:', result.error);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
