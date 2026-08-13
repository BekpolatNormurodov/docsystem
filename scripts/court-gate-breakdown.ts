// One-off: across the latest snapshot, how many clients clear the 4-doc court gate
// (talabnoma + palata-scan + oferta + boji-invoice), and how many are ONE doc away? Read-only.
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { readScannedArizas } from '../src/lib/palata-scan';

async function main() {
  const snap = await prisma.snapshot.findFirst({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' }, select: { id: true } });
  const snapshotId = snap?.id;
  const scanSet = new Set(readScannedArizas().map((r) => r.pinfl).filter(Boolean));

  const cases = await prisma.arizaCase.findMany({
    where: { ...(snapshotId ? { snapshotId } : {}) },
    select: { id: true, pinfl: true, kod: true, talabnomaAt: true, receiptNumber: true },
  });

  // oferta = has a summKr>0 loan at this firm. Bulk-load contract pinfls per branch once.
  const branchPinfls = new Map<string, Set<string>>();
  const loans = await prisma.loan.findMany({ where: { ...(snapshotId ? { snapshotId } : {}), summKr: { gt: 0 }, pinfl: { not: null } }, select: { pinfl: true, branchCode: true }, distinct: ['pinfl', 'branchCode'] });
  for (const l of loans) { if (!l.pinfl || !l.branchCode) continue; if (!branchPinfls.has(l.branchCode)) branchPinfls.set(l.branchCode, new Set()); branchPinfls.get(l.branchCode)!.add(l.pinfl); }

  let talabnoma = 0, scan = 0, oferta = 0, boji = 0, all4 = 0;
  let missOnlyScan = 0, missOnlyBoji = 0, missOnlyTalabnoma = 0, missOnlyOferta = 0;
  for (const c of cases) {
    const t = !!c.talabnomaAt;
    const s = !!(c.pinfl && scanSet.has(c.pinfl));
    const o = !!(c.pinfl && c.kod && branchPinfls.get(c.kod)?.has(c.pinfl));
    const b = !!c.receiptNumber;
    if (t) talabnoma++; if (s) scan++; if (o) oferta++; if (b) boji++;
    if (t && s && o && b) all4++;
    const miss = [!t, !s, !o, !b].filter(Boolean).length;
    if (miss === 1) {
      if (!s) missOnlyScan++;
      else if (!b) missOnlyBoji++;
      else if (!t) missOnlyTalabnoma++;
      else if (!o) missOnlyOferta++;
    }
  }

  console.log(`Snapshot #${snapshotId} — ${cases.length} case\n`);
  console.log(`Har bir hujjat bo'yicha (jami case ${cases.length}):`);
  console.log(`  Talabnoma yuborilgan : ${talabnoma}`);
  console.log(`  Palata skan (bor)    : ${scan}`);
  console.log(`  Oferta (shartnoma)   : ${oferta}`);
  console.log(`  Boji / invoice       : ${boji}`);
  console.log(`\n  ⇒ 4/4 TO'LIQ TAYYOR (sudga chiqadi): ${all4}`);
  console.log(`\n«Bitta hujjat yetmayapti» (1 qadam qoldi):`);
  console.log(`  faqat skan yetmaydi     : ${missOnlyScan}`);
  console.log(`  faqat boji yetmaydi     : ${missOnlyBoji}`);
  console.log(`  faqat talabnoma yetmaydi: ${missOnlyTalabnoma}`);
  console.log(`  faqat oferta yetmaydi   : ${missOnlyOferta}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
