import { prisma } from '../src/lib/db';
import { latinToCyrillic } from '../src/core/uz-latin-to-cyrillic';
import { normName } from '../src/lib/cabinet/status-ingest';

async function main() {
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  const loans = await prisma.loan.findMany({ where: { snapshotId: snap!.id, branchCode: '12842' }, select: { clientName: true, pinfl: true } });
  const idx = new Map<string, string>();
  for (const l of loans) if (l.clientName && l.pinfl) idx.set(normName(latinToCyrillic(l.clientName)), l.pinfl);
  console.log('portfolio names indexed:', idx.size);

  const unmatched = await prisma.clientCaseStatus.findMany({ where: { source: 'HIPPO', branchCode: '12842', pinfl: null }, select: { clientName: true }, take: 12 });
  console.log('\nsample UNMATCHED hippo receiverNames vs their transliteration:');
  for (const u of unmatched) {
    const n = normName(u.clientName);
    console.log(`  raw="${u.clientName}"  norm="${n}"  inPortfolio=${idx.has(n)}`);
  }
  // show a couple portfolio sample norms for comparison
  console.log('\nsample portfolio norm keys:');
  [...idx.keys()].slice(0, 4).forEach((k) => console.log('  ', k));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
