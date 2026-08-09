import { prisma } from '../src/lib/db';

async function main() {
  const pinfl = '62908055150038';

  // 1. is this pinfl in the portfolio (Loan)?
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  const inLoan = await prisma.loan.findMany({ where: { pinfl, snapshotId: snap!.id }, select: { branchCode: true, clientName: true, excluded: true } });
  console.log(`pinfl ${pinfl} in Loan (31.07): ${inLoan.length} rows`);
  inLoan.slice(0, 3).forEach((l) => console.log('   ', l.branchCode, l.clientName, 'excluded=' + l.excluded));

  // 2. is it in ClientCaseStatus?
  const inCCS = await prisma.clientCaseStatus.findMany({ where: { pinfl }, select: { branchCode: true, source: true, status: true, matchedBy: true } });
  console.log(`\npinfl ${pinfl} in ClientCaseStatus: ${inCCS.length} rows`);
  inCCS.forEach((r) => console.log('   ', r.branchCode, r.source, r.status, r.matchedBy));

  // 3. ClientCaseStatus by branchCode + source
  const g = await prisma.clientCaseStatus.groupBy({ by: ['branchCode', 'source'], _count: true });
  console.log('\nClientCaseStatus by firm+source:');
  g.forEach((x) => console.log(`   ${x.branchCode}  ${x.source}  ${x._count}`));

  // 4. raw tables in the DB (did another session create a different table?)
  const tables: any[] = await prisma.$queryRawUnsafe('SHOW TABLES');
  console.log('\nDB tables:', tables.map((t) => Object.values(t)[0]).join(', '));
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
