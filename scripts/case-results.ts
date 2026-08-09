import { prisma } from '../src/lib/db';

async function main() {
  // case_result distribution (the real outcome)
  const g = await prisma.clientCaseStatus.groupBy({
    by: ['status', 'caseResult'], where: { source: 'CABINET', branchCode: '12842' }, _count: true,
  });
  console.log('BRIGHT cabinet — status x caseResult:');
  g.sort((a, b) => b._count - a._count).forEach((x) =>
    console.log(`  ${String(x._count).padStart(4)}  ${x.status}  /  result=${x.caseResult ?? '—'}`));

  // portfolio-linked "done" (FULFILLED) count
  const fulfilled = await prisma.clientCaseStatus.count({ where: { source: 'CABINET', branchCode: '12842', caseResult: 'FULFILLED', pinfl: { not: null } } });
  const returned = await prisma.clientCaseStatus.count({ where: { source: 'CABINET', branchCode: '12842', caseResult: 'RETURNED', pinfl: { not: null } } });
  console.log(`\nportfolio-linked: FULFILLED (ish tugadi) = ${fulfilled}, RETURNED (qaytdi) = ${returned}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
