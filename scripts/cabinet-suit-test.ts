/**
 * SUIT-READY (stop-B) TEST — BITTA ish uchun.
 *
 * save-suit qilinadi (ADOLAT'da HAQIQIY ish yaratiladi, «Mening murojaatlarim»da turadi),
 * lekin send-to-court QILINMAYDI (dvigatelда majburiy to'xtaydi). Yurist portalda ochib,
 * to'g'ri ekanini ko'rib, O'ZI yuboradi.
 *
 * FAQAT BITTA ish — job caseIds=[<caseId>], suitMode=true. Worker courtSubmitLoop uni oladi.
 * ⚠ Ishlashi uchun SHU FIRMA firma-pauzasi olingan bo'lsin (suit-mode firma-pauzasiga
 *   bo'ysunadi); umumiy pauza qolaversin (u auto-resume'ni bloklab turadi).
 *
 * ISHLATISH:
 *   docker compose --env-file .env.production exec worker npx tsx scripts/cabinet-suit-test.ts <caseId> [firmId]
 */
import { prisma } from '../src/lib/db';

async function main() {
  const caseId = Number(process.argv[2]);
  const firmId = Number(process.argv[3] ?? '1');
  if (!Number.isInteger(caseId) || caseId <= 0) throw new Error('usage: cabinet-suit-test.ts <caseId> [firmId]');

  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: { id: true, firmId: true, clientName: true, stage: true, courtCaseId: true },
  });
  if (!ac) throw new Error(`Case topilmadi: ${caseId}`);
  if (ac.firmId !== firmId) console.warn(`⚠ Case ${caseId} firmId=${ac.firmId}, siz bergan firmId=${firmId} bilan mos emas.`);
  if (ac.courtCaseId) throw new Error(`Case ${caseId} allaqachon sudda (courtCaseId=${ac.courtCaseId}) — test qilinmaydi.`);

  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } });
  const job = await prisma.job.create({
    data: {
      type: 'COURT_SUBMIT',
      status: 'PENDING',
      snapshotId: snap?.id ?? null,
      total: 1,
      params: {
        firmId, snapshotId: snap?.id, caseIds: [caseId],
        ready: true, talabnomaPdf: true, includeGrafik: false,
        markExported: false, suitMode: true,
      },
    },
  });
  console.log(`✔ SUIT-TEST job #${job.id} yaratildi — case ${caseId} (${ac.clientName ?? ''}), firma ${firmId}, suitMode=true.`);
  console.log(`  Worker uni ~POLL ichida oladi. Log: docker compose ... logs worker | grep 'Job ${job.id}'`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1); });
