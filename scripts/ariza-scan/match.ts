// Identify a scanned ariza → WHO (client), WHICH firm, WHICH case (ariza) in the app.
// Matches on PINFL (+ firm), the same keys the pipeline uses. Input: ariza .txt
// files (text read from the scan). Output: the matched ArizaCase per ariza.
import 'dotenv/config';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { scanAriza } from './scan';
const prisma = new PrismaClient();

async function main() {
  const files = process.argv.slice(2);
  // Firm shortName → key, so we can map a scanned firm to the app's firm.
  const firms = await prisma.firm.findMany({ select: { id: true, code: true, shortName: true } });
  const firmByKey = (key: string) => firms.find((f) => (f.shortName || '').toUpperCase().includes(key));

  for (const file of files) {
    const a = scanAriza(fs.readFileSync(file, 'utf8'));
    console.log(`\n===== ${file} =====`);
    console.log(`  Kim   : ${a.clientName}  (PINFL ${a.pinfl || '?'})`);
    console.log(`  Firma : ${a.firmKey || '?'}`);
    if (!a.pinfl) { console.log('  ✗ PINFL topilmadi — moslab boʻlmaydi'); continue; }

    const firm = a.firmKey ? firmByKey(a.firmKey) : null;
    // Find the case(s) for this person; prefer the one at the scanned firm.
    const cases = await prisma.arizaCase.findMany({
      where: { pinfl: a.pinfl, ...(firm ? { firmId: firm.id } : {}) },
      select: { id: true, clientName: true, stage: true, snapshotId: true, firm: { select: { shortName: true } } },
      orderBy: { id: 'asc' },
    });
    if (cases.length === 0) {
      // maybe the firm filter was too strict — retry by pinfl only
      const any = await prisma.arizaCase.findMany({ where: { pinfl: a.pinfl }, select: { id: true, firm: { select: { shortName: true } } } });
      console.log(any.length ? `  ⚠ shu firmada case yoʻq; PINFL boʻyicha: ${any.map((c) => `#${c.id}(${c.firm?.shortName})`).join(', ')}` : '  ✗ Bazada bu PINFL topilmadi');
      continue;
    }
    for (const c of cases) {
      console.log(`  ✓ CASE #${c.id} → ${c.clientName} · ${c.firm?.shortName} · stage=${c.stage} · snapshot=${c.snapshotId}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
