// Pull cabinet cases for a firm, match to portfolio, store real statuses in DB,
// and print the per-firm status board from the DB. Stored session, no signing.
//   npx tsx scripts/cabinet-status-sync.ts [account=311976765] [branchCode=12842]
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { ingestCabinetStatuses } from '../src/lib/cabinet/status-ingest';
import { prisma } from '../src/lib/db';

async function main() {
  const account = process.argv[2] ?? '311976765';
  const branchCode = process.argv[3] ?? '12842';
  const s = await getStoredCabinetSession(account);

  const res = await ingestCabinetStatuses(s, branchCode);
  console.log(`\nfirm ${branchCode}: stored ${res.totalCases} cabinet cases`);
  console.log(`  matched to portfolio (pinfl): ${res.matched} (${(res.matched / res.totalCases * 100).toFixed(0)}%)  | unmatched: ${res.unmatched}`);
  console.log('\n  by status:');
  for (const [st, n] of Object.entries(res.byStatus).sort((a, b) => b[1] - a[1]))
    console.log(`    ${String(n).padStart(4)}  ${st}`);

  // read back from DB — the real board
  const grouped = await prisma.clientCaseStatus.groupBy({
    by: ['status'], where: { branchCode, source: 'CABINET' }, _count: true,
  });
  console.log('\n  (verified from DB) ClientCaseStatus rows:',
    grouped.reduce((a, g) => a + g._count, 0));
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
