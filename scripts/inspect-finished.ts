import { prisma } from '../src/lib/db';

async function main() {
  // a few FINISHED cases with their full stored detail
  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'CABINET', branchCode: '12842', status: 'FINISHED', detail: { not: undefined } },
    select: { clientName: true, caseNumber: true, caseResult: true, detail: true },
    take: 4,
  });
  for (const r of rows) {
    const d: any = r.detail ?? {};
    console.log(`\n${r.clientName}  #${r.caseNumber}  caseResult=${r.caseResult ?? '—'}`);
    console.log('  detail keys:', Object.keys(d).join(', '));
    // hunt for execution/ijro/mib/result/definition fields
    for (const k of Object.keys(d)) {
      if (/result|definition|execution|ijro|mib|status|decision|verdict|ruling/i.test(k))
        console.log(`   ${k}:`, JSON.stringify(d[k]).slice(0, 200));
    }
    // does the raw detail mention execution/ijro anywhere?
    const s = JSON.stringify(d);
    const hit = s.match(/ijro|ispoln|execution|majburiy|undir/gi);
    if (hit) console.log('   -> mentions:', [...new Set(hit)].join(', '));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
