/**
 * test-court-send.ts — BITTA case'ni HAQIQIY sudga yuborish (test). prepare-ready bilan
 * bir xil: tayyorligini qayta tekshiradi, PACKET job (markExported:true) yaratadi — ishlab
 * turgan worker paketni quradi + «Yuborilgan» belgilaydi (statistikaga chiqadi). QAYTARILADI:
 * keyin `court-undo` yoki --undo bilan «Tayyor»ga qaytariladi.
 *
 *   node --import tsx scripts/test-court-send.ts <caseId>          # yuboradi (markExported)
 *   node --import tsx scripts/test-court-send.ts <caseId> --undo   # o'sha case'ni bekor qiladi
 */
import { prisma } from '../src/lib/db';
import { validateSelectedCaseIds, undoCaseState } from '../src/lib/court-ready';

const caseId = Number(process.argv[2] || 0);
const UNDO = process.argv.includes('--undo');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!caseId) throw new Error('caseId kerak');
  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { firmId: true, snapshotId: true, clientName: true } });
  if (!ac) throw new Error('case topilmadi');

  if (UNDO) {
    const n = await undoCaseState([caseId]);
    console.log(`Bekor qilindi: ${n} ta (case ${caseId} → «Tayyor»)`);
    return;
  }

  const ids = await validateSelectedCaseIds({ snapshotId: ac.snapshotId ?? undefined, firmId: ac.firmId, caseIds: [caseId] });
  if (!ids.length) { console.log(`❌ Case ${caseId} yuborishga TAYYOR emas (gate o'tmadi) — yuborilmadi`); return; }

  const job = await prisma.job.create({
    data: { type: 'PACKET', status: 'PENDING', snapshotId: ac.snapshotId ?? null, total: 1,
      params: { firmId: ac.firmId, snapshotId: ac.snapshotId ?? undefined, caseIds: ids, ready: true, talabnomaPdf: true, includeGrafik: false, markExported: true } },
  });
  console.log(`Job ${job.id} PENDING — worker quradi + markExported (case ${caseId} · ${ac.clientName})…`);

  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const j = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true, progress: true, total: true, message: true } });
    if (!j) continue;
    if (j.status === 'DONE' || j.status === 'FAILED') {
      console.log(`Job ${j.status}: ${j.message ?? ''}`);
      const after = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { meta: true, courtSentAt: true } });
      const meta = (after?.meta && typeof after.meta === 'object' && !Array.isArray(after.meta)) ? after.meta as Record<string, unknown> : {};
      console.log(`  exportedAt=${meta.exportedAt ?? '—'}  courtSentAt=${after?.courtSentAt ?? '—'}`);
      console.log(meta.exportedAt ? '  ✅ «Yuborilgan» belgilandi — statistikada ko\'rinadi. Bekor: --undo' : '  ❌ markExported bo\'lmadi');
      return;
    }
    if (i % 3 === 0) console.log(`  … ${j.status} ${j.progress}/${j.total}`);
  }
  console.log('⏱ Job hali tugamadi (worker sekin?) — keyinroq tekshiring.');
}
main().catch((e) => { console.error('❌ XATO:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
