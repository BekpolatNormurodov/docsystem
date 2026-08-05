import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { parseExclusionPinfls } from '../src/lib/parse-exclusion';
(async () => {
  const file = process.argv[2];
  const set = await parseExclusionPinfls(file);
  console.log('exclusion pinfls parsed:', set.size);
  const snap = await prisma.snapshot.findFirst({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' } });
  if (!snap) throw new Error('no READY snapshot');
  const r = await prisma.loan.updateMany({ where: { snapshotId: snap.id, pinfl: { in: [...set] } }, data: { excluded: true } });
  const exClients = (await prisma.loan.groupBy({ by: ['pinfl'], where: { snapshotId: snap.id, excluded: true } })).length;
  await prisma.snapshot.update({ where: { id: snap.id }, data: { excludedCount: r.count } });
  console.log('marked', r.count, 'loans excluded across', exClients, 'clients in snapshot', snap.id, snap.reportDate.toISOString().slice(0,10));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
