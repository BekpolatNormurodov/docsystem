/**
 * test-court-packet.ts — bitta case uchun SUD paketini to'liq qurib ko'radi (chromium bilan
 * talabnoma/oferta PDF, ariza .docx, palata skani, chek, firma hujjatlari). HECH NARSA
 * o'zgartirmaydi: markExported yo'q, ZIP saqlanmaydi — faqat fayllar ro'yxatini chiqaradi.
 * «Sudga yuborishda xato bo'lmasligi»ni tekshirish uchun. WORKER image'da yuriladi (chromium bor).
 *
 *   node --import tsx scripts/test-court-packet.ts <caseId>
 */
import { chromium } from 'playwright';
import { prisma } from '../src/lib/db';
import { buildCasePacket } from '../src/lib/konveyer-packet';

const caseId = Number(process.argv[2] || 0);

async function main() {
  if (!caseId) throw new Error('caseId kerak: node ... scripts/test-court-packet.ts <caseId>');
  console.log(`Case ${caseId} — sud paketini quramiz (chromium bilan)…`);
  const browser = await chromium.launch({ headless: true });
  try {
    const packet = await buildCasePacket(caseId, { browser, talabnomaPdf: true, includeFirmDocs: true, includeGrafik: false });
    if (!packet) { console.log('❌ PACKET NULL — case topilmadi yoki pinfl/snapshot yo‘q'); return; }
    console.log(`\n✅ Paket qurildi — ${packet.folder}`);
    console.log(`   firm=${packet.firmName} · talabnomaMade=${packet.talabnomaMade} · arizaMade=${packet.arizaMade}`);
    console.log(`   Fayllar (${packet.files.length}):`);
    let hasInvoice = false, hasReceipt = false, hasSignedAriza = false;
    for (const f of packet.files) {
      console.log(`     ${String(Math.round(f.buf.length / 1024)).padStart(5)} KB  ${f.name}`);
      const n = f.name.toUpperCase();
      if (n.startsWith('INVOICE')) hasInvoice = true;
      if (n.startsWith('TALABNOMA_RECEIPT')) hasReceipt = true;
      if (n.startsWith('SIGNED_ARIZA')) hasSignedAriza = true;
    }
    console.log(`\n   Tekshiruv:`);
    console.log(`     chek (TALABNOMA_RECEIPT) sudga kirdi:      ${hasReceipt ? '✅ ha' : '❌ YO‘Q'}`);
    console.log(`     imzolangan skan (SIGNED_ARIZA) kirdi:      ${hasSignedAriza ? '✅ ha' : '❌ YO‘Q'}`);
    console.log(`     INVOICE (billing) sudga KIRMASLIGI kerak:  ${hasInvoice ? '❌ KIRIB QOLDI (xato!)' : '✅ kirmadi (to‘g‘ri)'}`);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error('❌ XATO:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
