// Fetch every cabinet case's detail (exact defendant PINFL + address/passport/
// judge) and enrich ClientCaseStatus. Stored session, no signing.
//   npx tsx scripts/cabinet-detail-sync.ts [account=311976765] [branchCode=12842]
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { ingestCabinetDetails } from '../src/lib/cabinet/detail-ingest';
import { prisma } from '../src/lib/db';

async function main() {
  const account = process.argv[2] ?? '311976765';
  const branchCode = process.argv[3] ?? '12842';
  const s = await getStoredCabinetSession(account);
  console.log(`fetching case details for ${branchCode} (exact PINFL linking)...`);
  const r = await ingestCabinetDetails(s, branchCode);
  console.log(`\ntotal ${r.total} | detail fetched ${r.fetched} | with defendant PINFL ${r.withPinfl} | failed ${r.failed}`);

  const byMatch = await prisma.clientCaseStatus.groupBy({ by: ['matchedBy'], where: { source: 'CABINET', branchCode }, _count: true });
  console.log('matchedBy:', byMatch.map((m) => `${m.matchedBy}=${m._count}`).join('  '));
  const sample = await prisma.clientCaseStatus.findFirst({ where: { source: 'CABINET', branchCode, matchedBy: 'PINFL', defAddress: { not: null } }, select: { clientName: true, pinfl: true, defAddress: true, defPassport: true, judge: true, status: true } });
  if (sample) { console.log('\nsample enriched:'); console.log(' ', JSON.stringify(sample)); }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
