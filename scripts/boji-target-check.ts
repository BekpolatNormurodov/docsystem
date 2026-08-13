// One-off: reconcile the court-gate «scan» (palata-scan.json) with billing eligibility (stage
// SIGNED_SCANNED, no receipt). Are the «faqat boji yetmaydi» clients actually invoiceable? Read-only.
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { readScannedArizas } from '../src/lib/palata-scan';

async function main() {
  const snap = await prisma.snapshot.findFirst({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' }, select: { id: true } });
  const snapshotId = snap?.id;
  const scanSet = new Set(readScannedArizas().map((r) => r.pinfl).filter(Boolean));

  const cases = await prisma.arizaCase.findMany({
    where: { ...(snapshotId ? { snapshotId } : {}) },
    select: { id: true, pinfl: true, kod: true, stage: true, talabnomaAt: true, receiptNumber: true },
  });
  const loans = await prisma.loan.findMany({ where: { ...(snapshotId ? { snapshotId } : {}), summKr: { gt: 0 }, pinfl: { not: null } }, select: { pinfl: true, branchCode: true }, distinct: ['pinfl', 'branchCode'] });
  const ofertaSet = new Set(loans.map((l) => `${l.pinfl}::${l.branchCode}`));

  let faqatBoji = 0;
  const bojiByStage: Record<string, number> = {};
  let signedScannedNoReceipt = 0;      // billing-eligible pool
  let signedScannedInJson = 0;         // billing-eligible AND court-gate scan
  for (const c of cases) {
    const t = !!c.talabnomaAt;
    const s = !!(c.pinfl && scanSet.has(c.pinfl));
    const o = !!(c.pinfl && c.kod && ofertaSet.has(`${c.pinfl}::${c.kod}`));
    const b = !!c.receiptNumber;
    if (t && s && o && !b) { faqatBoji++; bojiByStage[c.stage] = (bojiByStage[c.stage] ?? 0) + 1; }
    if (c.stage === 'SIGNED_SCANNED' && !b) { signedScannedNoReceipt++; if (s) signedScannedInJson++; }
  }

  console.log(`Snapshot #${snapshotId}`);
  console.log(`\n«faqat boji yetmaydi» (talabnoma+scan(json)+oferta, boji yo'q): ${faqatBoji}`);
  console.log(`  ular qaysi bosqichda:`);
  for (const [st, n] of Object.entries(bojiByStage).sort((a, b) => b[1] - a[1])) console.log(`    ${st}: ${n}`);
  console.log(`\nBilling-eligible (stage SIGNED_SCANNED, receiptsiz): ${signedScannedNoReceipt}`);
  console.log(`  ...ulardan palata-json scan ham bor: ${signedScannedInJson}`);
  console.log(`\n⇒ Xulosa: court-gate «scan» = palata-json (${scanSet.size} pinfl); billing = stage SIGNED_SCANNED.`);
  console.log(`   Bu ikki ta'rif ${faqatBoji > 0 && !Object.keys(bojiByStage).includes('SIGNED_SCANNED') ? 'MOS EMAS' : 'qisman mos'} — pastdagi bosqich taqsimotiga qarang.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
