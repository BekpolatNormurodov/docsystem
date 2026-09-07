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
import { collectCaseFiles, assertFirmDocsBelongToFirm } from '../src/lib/court-submit-job';
import { resolveClaimantId } from '../src/lib/cabinet/claimant';
import { resolveCabinetCourtGuid, CABINET_COURT_IDS, CABINET_REGION_IDS } from './constants';
import type { SourceCaseData } from './builder';
import type { CaseFileToUpload } from './uploader';

// Da'vogar GUID endi qattiq yozilgan lug'atda emas — src/lib/cabinet/claimant.ts uni
// Firm.cabinetClaimantId dan o'qiydi yoki portaldan (user/entities, STIR bo'yicha aniq
// moslik) topib bazaga yozib qo'yadi. Bu yerdagi eski nusxa faqat BRIGHT'ni bilardi va
// qolgan firmalar uchun skript ishlamasdi.

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
  let sessionForClaimant: Awaited<ReturnType<typeof getStoredCabinetSession>> | undefined;
  {
    try {
      const session = await getStoredCabinetSession(firmStir);
      sessionForClaimant = session;
      if (!sessionToken) sessionToken = session.token;
      console.log(`✔ Faol Cabinet sessiyasi topildi (Foydalanuvchi: ${session.user.username || 'OK'})`);
    } catch (e: any) {
      if (sessionToken) {
        console.log('✔ Maxsus CABINET_TOKEN ishlatiladi (saqlangan sessiya yo\'q).');
        // Sessiyasiz da'vogarni portaldan topib bo'lmaydi — Firm.cabinetClaimantId shart.
      } else {
        console.error(`❌ Firmaning cabinet sessiyasi topilmadi yoki muddati o'tgan: ${e.message}`);
        console.error(`Iltimos, saytda «Ulanishlar» orqali E-IMZO bilan qayta kiring yoki CABINET_TOKEN env o'rnating.`);
        process.exit(1);
      }
    }
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

  // Da'vogar: bazadan; bo'lmasa portaldan STIR bo'yicha aniq topib saqlanadi.
  let claimantId: string;
  try {
    claimantId = await resolveClaimantId(ac.firm, sessionForClaimant);
    console.log(`✔ Da'vogar (claimant): ${claimantId}`);
  } catch (e: any) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const caseData: SourceCaseData = {
    courtId: courtGuid,
    regionId: CABINET_REGION_IDS.TOSHKENT_VILOYATI,
    claimantId,
    receiptNumber: ac.receiptNumber ?? null,
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
  // Firma hujjatlari haqiqatan shu firmaniki ekanini tekshiramiz — sayt oqimida bu tekshiruv
  // bor edi, skript esa uni chetlab o'tardi va boshqa firmaning ishonchnomasi bilan da'vo
  // tayyorlanardi (2026-09-07: URBAN ishi BRIGHT ishonchnomasi bilan ketgan).
  await assertFirmDocsBelongToFirm(ac.firm.id, ac.firm.shortName);

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
      console.log(`Sud ishi: ${result.caseId ?? '?'} ${result.caseNumber ? '(raqam: ' + result.caseNumber + ')' : '— raqamni sud kantselyariyasi keyinroq beradi'}`);
      if (result.registryNumber) console.log(`Reestr raqami : ${result.registryNumber}`);

      // Bazada ish holatini COURT_SUBMITTED ga o'tkazish
      await prisma.arizaCase.update({
        where: { id: ac.id },
        data: {
          stage: 'COURT_SUBMITTED',
          stageEnteredAt: new Date(),
          courtSentAt: new Date(),
          courtCaseId: result.caseId || result.caseNumber || result.registryNumber || null,
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
