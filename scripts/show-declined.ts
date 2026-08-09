import { prisma } from '../src/lib/db';

async function main() {
  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'CABINET', status: 'DECLINED' },
    select: { pinfl: true, clientName: true, caseNumber: true, claimKind: true, defAddress: true, defPassport: true, matchedBy: true },
  });
  console.log(`DECLINED (bekor qilingan) cabinet cases: ${rows.length}\n`);
  rows.forEach((r) => {
    console.log(`PINFL: ${r.pinfl ?? '—'}  | ${r.clientName}`);
    console.log(`   kind=${r.claimKind}  matchedBy=${r.matchedBy}  passport=${r.defPassport ?? '-'}`);
    console.log(`   manzil: ${r.defAddress ?? '-'}`);
    console.log(`   case: ${r.caseNumber}\n`);
  });

  // also confirm overall DB state
  const total = await prisma.clientCaseStatus.count();
  const withPinfl = await prisma.clientCaseStatus.count({ where: { pinfl: { not: null } } });
  console.log(`ClientCaseStatus jami: ${total}, pinfl bor: ${withPinfl}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
