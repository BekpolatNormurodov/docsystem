import { prisma } from '../src/lib/db';

async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(
    'SELECT kod, stage, COUNT(*) c FROM arizacase GROUP BY kod, stage ORDER BY kod, c DESC',
  );
  const byFirm = new Map<string, string[]>();
  for (const r of rows) {
    if (!byFirm.has(r.kod)) byFirm.set(r.kod, []);
    byFirm.get(r.kod)!.push(`${r.stage}=${Number(r.c)}`);
  }
  for (const [firm, stages] of byFirm) console.log(`${firm}: ${stages.join('  ')}`);

  // sample: a BRIGHT client with a court case + due date
  const s: any[] = await prisma.$queryRawUnsafe(
    "SELECT pinfl, clientName, stage, stageEnteredAt, dueAt, courtCaseId, JSON_EXTRACT(meta,'$.courtStatus') courtStatus FROM arizacase WHERE kod='12842' AND courtCaseId IS NOT NULL LIMIT 3",
  );
  console.log('\nsample BRIGHT court-linked:');
  s.forEach((x) => console.log(`  ${x.pinfl} ${x.clientName} | stage=${x.stage} courtStatus=${x.courtStatus} case=${x.courtCaseId} due=${x.dueAt}`));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
