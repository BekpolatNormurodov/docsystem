// scripts/court-resume.ts
// Uzilib qolgan sud partiyasini DAVOM ETTIRADI — saytdagi «Sudga yuborish» tugmasi bilan
// bir xil ishni qiladi, lekin terminaldan.
//
// Nega kerak: worker qayta ishga tushsa (deploy, restart) ketayotgan partiya uziladi. Ishlar
// yo'qolmaydi — CourtQueueItem'da PENDING bo'lib qoladi. Lekin worker `Job` jadvalidan ish
// oladi, navbat yozuvlaridan emas: job yiqilgach yangisi yaratilmaydi va hech narsa ketmaydi.
// Bu skript o'sha PENDING ishlar uchun yangi COURT_SUBMIT job yaratadi.
//
// Takrorlanmaydi: allaqachon yuborilganlar (state=DONE) olinmaydi, va dvigatelning o'zida ham
// idempotentlik bor (CourtQueueItem.caseId unique).
//
//   npx tsx scripts/court-resume.ts <firmId> [soni]
//   npx tsx scripts/court-resume.ts 2            → URBAN, hammasi (max 100)
//   npx tsx scripts/court-resume.ts 2 10         → URBAN, 10 ta
import { prisma } from '../src/lib/db';
import { enqueueJob } from '../src/lib/job-dispatch';
import { allocateFirmCases, consumeCourtSend, firmCourtBudgets } from '../src/lib/court-routing';
import { isQueuePaused } from '../src/lib/cabinet/pacer';

async function main() {
  const firmId = Number(process.argv[2]);
  const limit = Math.min(100, Math.max(1, Number(process.argv[3]) || 100));
  if (!Number.isInteger(firmId) || firmId <= 0) {
    console.error('Foydalanish: npx tsx scripts/court-resume.ts <firmId> [soni]');
    console.error('  firmId: 1=BRIGHT  2=URBAN  3=COMMUNITY');
    process.exit(1);
  }

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, shortName: true } });
  if (!firm) { console.error(`Firma topilmadi: id=${firmId}`); process.exit(1); }

  if (await isQueuePaused()) {
    console.error('Jarayon PAUZADA. Saytdagi «Davom ettirish» tugmasini bosing yoki pauzani oching.');
    process.exit(1);
  }

  // Navbatda tugamagan ishlar (eng eskisidan) — DONE bo'lganlar olinmaydi.
  const pending = await prisma.courtQueueItem.findMany({
    where: { firmId, state: { in: ['PENDING', 'FAILED'] } },
    orderBy: { id: 'asc' },
    take: limit,
    select: { caseId: true, state: true },
  });
  if (pending.length === 0) {
    console.log(`${firm.shortName}: navbatda tugamagan ish yo'q. Yangi partiya uchun saytdan «Sudga yuborish»ni bosing.`);
    await prisma.$disconnect();
    return;
  }

  const caseIds = pending.map((p) => p.caseId);
  console.log(`${firm.shortName}: navbatda ${pending.length} ta ish topildi (${pending.filter((p) => p.state === 'FAILED').length} tasi avval xato bergan).`);

  // Sud kunlik limiti — saytdagi bilan bir xil qoida. Sig'magani bugun yuborilmaydi.
  const alloc = await allocateFirmCases(firmId, caseIds);
  let sendIds = caseIds;
  if (alloc) {
    sendIds = alloc.assignments.map((a) => a.caseId);
    if (sendIds.length === 0) {
      const budgets = await firmCourtBudgets(firmId);
      console.error('Bugun yuborib bo\'lmaydi: ' + budgets.map((b) => `${b.court.shortName}: ${b.remaining}/${b.court.dailyQuota} qoldi (${b.window.reason})`).join(' · '));
      process.exit(1);
    }
    if (alloc.deferred.length) console.log(`  ${alloc.deferred.length} tasi kunlik limitdan oshdi — keyingi kunga qoldi.`);
    await consumeCourtSend(alloc.assignments);
  }

  const job = await prisma.job.create({
    data: {
      type: 'COURT_SUBMIT',
      status: 'PENDING',
      total: sendIds.length,
      params: { firmId, caseIds: sendIds, ready: true, markExported: true },
    },
  });
  enqueueJob(job.id);

  console.log(`\n✔ Job #${job.id} yaratildi — ${sendIds.length} ta ish navbatga qo'yildi.`);
  console.log('  Holatni «Sudga yuborish» sahifasidagi navbat panelida kuzating.');

  await prisma.$disconnect();
}

main().catch((e) => { console.error('Xato:', e.message); process.exit(1); });
