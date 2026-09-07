// scripts/zip-firm.ts
// Firma bo'yicha TAYYOR mijozlarni bitta ZIP arxiviga yig'adi — saytdagi «ZIP» tugmasi bilan
// bir xil ish, lekin terminaldan.
//
// Nega kerak: 600+ mijozlik eksportni brauzerdan boshlash noqulay (sahifa ochiq turishi,
// sessiya, tasodifan ikki marta bosish). Bu skript job'ni bazada yaratadi, worker esa uni
// odatdagidek oladi — ya'ni natija saytdagi «Tarix»da ham, /api/export/<id>/download da ham
// bir xil ko'rinadi.
//
// ZIP sudga HECH NARSA yubormaydi: portalga bitta ham so'rov ketmaydi, kunlik limit band
// qilinmaydi (consumeCourtSend markSent=false), E-IMZO talab qilinmaydi.
//
//   npx tsx scripts/zip-firm.ts <firmId> [soni]
//   npx tsx scripts/zip-firm.ts 2            → URBAN, tayyorlarning HAMMASI (max 1000)
//   npx tsx scripts/zip-firm.ts 2 250        → URBAN, 250 ta
import { prisma } from '../src/lib/db';
import { konveyerSnapshots } from '../src/lib/konveyer';
import { selectReadyCaseIds } from '../src/lib/court-ready';
import { MAX_ZIP_BATCH } from '../src/lib/court-batch';
import { allocateFirmCases, consumeCourtSend } from '../src/lib/court-routing';

async function main() {
  const firmId = Number(process.argv[2]);
  const limit = Math.min(MAX_ZIP_BATCH, Math.max(1, Number(process.argv[3]) || MAX_ZIP_BATCH));
  if (!Number.isInteger(firmId) || firmId <= 0) {
    console.error('Foydalanish: npx tsx scripts/zip-firm.ts <firmId> [soni]');
    console.error('  firmId: 1=BRIGHT  2=URBAN  3=COMMUNITY');
    process.exit(1);
  }

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, shortName: true } });
  if (!firm) { console.error(`Firma #${firmId} topilmadi.`); process.exit(1); }

  const snaps = await konveyerSnapshots();
  const snapshotId = snaps[0]?.id;

  const caseIds = await selectReadyCaseIds({ snapshotId, firmId, limit, includeExported: false, forExport: true });
  if (caseIds.length === 0) {
    console.error(`${firm.shortName}: chiqarilmagan tayyor mijoz yo'q.`);
    process.exit(1);
  }

  // Sudni biriktiramiz (ariza matnida qaysi sudga murojaat qilinayotgani yoziladi), lekin
  // ignoreQuota=true — kunlik limit ZIP tanlovini kesmasin, va markSent=false — limit band
  // bo'lmasin. ZIP fayl tayyorlashdan boshqa hech narsa qilmaydi.
  const alloc = await allocateFirmCases(firmId, caseIds, new Date(), undefined, true);
  const sendIds = alloc ? alloc.assignments.map((a) => a.caseId) : caseIds;
  if (alloc) await consumeCourtSend(alloc.assignments, new Date(), false);
  if (sendIds.length === 0) { console.error('Sud biriktirib bo\'lmadi — hech narsa tanlanmadi.'); process.exit(1); }

  const job = await prisma.job.create({
    data: {
      type: 'PACKET',
      status: 'PENDING',
      snapshotId: snapshotId ?? null,
      total: sendIds.length,
      params: { firmId, snapshotId, caseIds: sendIds, ready: true, talabnomaPdf: true, includeGrafik: false, markExported: true },
    },
  });

  console.log(`✔ ${firm.shortName}: ${sendIds.length} ta mijoz uchun ZIP job #${job.id} navbatga qo'yildi.`);
  console.log(`  Holat:  SELECT status,progress,total FROM Job WHERE id=${job.id};`);
  console.log(`  Yuklab olish (tugagach): /api/export/${job.id}/download`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
