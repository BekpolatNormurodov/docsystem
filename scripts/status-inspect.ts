import { prisma } from '../src/lib/db';

async function main() {
  const cab = await prisma.clientCaseStatus.count({ where: { source: 'CABINET' } });
  const hip = await prisma.clientCaseStatus.count({ where: { source: 'HIPPO' } });
  const inv = await prisma.courtFeeInvoice.count();
  console.log(`DB (docsystem): ClientCaseStatus CABINET=${cab} HIPPO=${hip} | CourtFeeInvoice=${inv}\n`);

  // sample: a court client joined to their statuses
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  const l = await prisma.loan.findFirst({ where: { snapshotId: snap!.id, branchCode: '12842', excluded: true }, select: { pinfl: true, clientName: true } });
  const st = await prisma.clientCaseStatus.findMany({ where: { pinfl: l!.pinfl }, select: { source: true, status: true, caseNumber: true } });
  console.log(`sample client ${l!.pinfl} ${l!.clientName}`);
  st.forEach((s) => console.log(`   ${s.source}  ${s.status}  ${s.caseNumber ?? ''}`));

  // DECLINED cabinet cases — with their result/reason
  const declined = await prisma.clientCaseStatus.findMany({
    where: { source: 'CABINET', branchCode: '12842', status: 'DECLINED' },
    select: { clientName: true, caseNumber: true, caseResult: true, category: true, claimKind: true },
  });
  console.log(`\nDECLINED cabinet cases: ${declined.length}`);
  declined.forEach((d) => console.log(`   ${d.clientName}  #${d.caseNumber}  kind=${d.claimKind}  natija/sabab: ${d.caseResult ?? '—'}`));
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
