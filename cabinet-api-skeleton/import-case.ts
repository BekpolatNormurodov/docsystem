// cabinet-api-skeleton/import-case.ts
// Serverdan olingan bitta case (JSON) va uning fayllarini Mac bazasiga yuklash.

import fs from 'node:fs/promises';
import { prisma } from '../src/lib/db';

async function main() {
  const filePath = process.argv[2] || 'case_3505.json';
  const raw = await fs.readFile(filePath, 'utf-8');
  const { ac, loans, sess } = JSON.parse(raw);

  // 1. ExternalSession (Bright sessiyasini Mac ga yozish)
  if (Array.isArray(sess)) {
    for (const s of sess) {
      await prisma.externalSession.upsert({
        where: { provider_account: { provider: s.provider, account: s.account } },
        create: {
          provider: s.provider,
          account: s.account,
          status: s.status,
          accessToken: s.accessToken,
          tokenId: s.tokenId,
          meta: s.meta,
          expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
        },
        update: {
          status: s.status,
          accessToken: s.accessToken,
          tokenId: s.tokenId,
          meta: s.meta,
          expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
        },
      });
    }
    console.log(`✔ Cabinet sessiyasi saqlandi.`);
  }

  // 2. Agar ac.court bo'lsa, Court ni yaratish/yangilash
  if (ac.court) {
    await prisma.court.upsert({
      where: { id: ac.court.id },
      create: {
        id: ac.court.id,
        billingCourtId: ac.court.billingCourtId || '587',
        courtType: ac.court.courtType || 'CITIZEN',
        nameUz: ac.court.nameUz,
        shortName: ac.court.shortName,
        dailyQuota: ac.court.dailyQuota || 1000,
        cutoffMinutes: ac.court.cutoffMinutes || 1200,
        weekdays: ac.court.weekdays || [1, 2, 3, 4, 5, 6],
        active: true,
        isDefault: false,
      },
      update: {
        billingCourtId: ac.court.billingCourtId || '587',
        nameUz: ac.court.nameUz,
        shortName: ac.court.shortName,
      },
    });
    console.log(`✔ Court #${ac.court.id} (${ac.court.shortName}) saqlandi.`);
  }

  // 3. ArizaCase ni Mac bazasida PINFL va firmId bo'yicha topish yoki yangilash
  let targetCase = await prisma.arizaCase.findFirst({
    where: { pinfl: ac.pinfl, firmId: ac.firmId || 1 },
  });

  if (targetCase) {
    targetCase = await prisma.arizaCase.update({
      where: { id: targetCase.id },
      data: {
        courtId: ac.courtId || 3,
        totalDebt: ac.totalDebt,
        stage: ac.stage,
        receiptNumber: ac.receiptNumber,
      },
    });
  } else {
    targetCase = await prisma.arizaCase.create({
      data: {
        firmId: ac.firmId || 1,
        courtId: ac.courtId || 3,
        pinfl: ac.pinfl,
        clientName: ac.clientName,
        kod: ac.kod,
        totalDebt: ac.totalDebt,
        stage: ac.stage,
        receiptNumber: ac.receiptNumber,
      },
    });
  }
  console.log(`✔ Case #${targetCase.id} (${targetCase.clientName}, PINFL: ${targetCase.pinfl}) yangilandi.`);

  // 4. CaseDocument hujjatlarini biriktirish
  if (Array.isArray(ac.documents)) {
    await prisma.caseDocument.deleteMany({ where: { caseId: targetCase.id } });
    for (const doc of ac.documents) {
      await prisma.caseDocument.create({
        data: {
          caseId: targetCase.id,
          kind: doc.kind,
          fileName: doc.fileName,
          filePath: doc.filePath.startsWith('/app/') 
            ? doc.filePath.replace(/^\/app\//, `${process.cwd()}/`)
            : (doc.filePath.startsWith('/') ? doc.filePath : `${process.cwd()}/${doc.filePath}`),
          size: doc.size || 0,
        },
      });
      console.log(`  📄 Hujjat biriktirildi: [${doc.kind}] ${doc.fileName}`);
    }
  }

  console.log(`\n🎉 Hammasi tayyor! Endi to'g'ridan-to'g'ri ishga tushirish mumkin:`);
  console.log(`   npx tsx cabinet-api-skeleton/send-one-live.ts ${targetCase.id} --dry-run`);
  console.log(`   npx tsx cabinet-api-skeleton/send-one-live.ts ${targetCase.id}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Xatolik:', e);
  await prisma.$disconnect();
  process.exit(1);
});
