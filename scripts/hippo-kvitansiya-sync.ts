// Download the hippo delivery-receipt (kvitansiya) PDF for every portfolio-linked
// talabnoma and record its path in ClientCaseStatus.docPath. Reuses the stored
// hippo session (no signing). Files -> exports/hippo-kvitansiya/{branchCode}/.
//   npx tsx scripts/hippo-kvitansiya-sync.ts [branchCode=12842]
import fs from 'node:fs/promises';
import path from 'node:path';
import { getStoredHippoSession } from '../src/lib/hippo/session';
import { downloadReceiptPdf } from '../src/lib/hippo/xat';
import { firmByBranch } from '../src/lib/firms';
import { prisma } from '../src/lib/db';

async function main() {
  const branchCode = process.argv[2] ?? '12842';
  const firm = firmByBranch(branchCode);
  if (!firm) throw new Error(`unknown firm ${branchCode}`);
  const s = await getStoredHippoSession(firm.stir); // no signing

  // portfolio-linked hippo talabnomas (pinfl matched)
  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'HIPPO', branchCode, pinfl: { not: null } },
    select: { id: true, caseNumber: true, pinfl: true, clientName: true, status: true, docPath: true },
  });
  console.log(`portfolio-linked hippo talabnomas: ${rows.length}`);
  const dir = path.join(process.cwd(), 'exports', 'hippo-kvitansiya', branchCode);
  await fs.mkdir(dir, { recursive: true });

  let ok = 0, skip = 0, fail = 0;
  for (const r of rows) {
    if (r.docPath) { skip++; continue; } // already downloaded
    try {
      const buf = await downloadReceiptPdf(s, r.caseNumber!);
      if (!buf || buf.length < 500 || buf.slice(0, 4).toString() !== '%PDF') { fail++; continue; }
      const file = path.join(dir, `${r.pinfl}_${r.caseNumber}.pdf`);
      await fs.writeFile(file, buf);
      await prisma.clientCaseStatus.update({ where: { id: r.id }, data: { docPath: file } });
      ok++;
      if (ok % 50 === 0) console.log(`  ...${ok} downloaded`);
    } catch { fail++; }
  }
  console.log(`\n✅ downloaded ${ok}, skipped(existing) ${skip}, no-receipt/failed ${fail} -> ${dir}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
