import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { runExportJob } from '../src/lib/export-arizas';

async function main() {
  const snap = await prisma.snapshot.findUnique({ where: { reportDate: new Date('2026-07-09') } });
  if (!snap) throw new Error('no snapshot for 2026-07-09');
  const minDebt = Number(process.argv[2] || 103000000);
  const where: any = { snapshotId: snap.id, totalDebt: { gte: minDebt } };
  const count = await prisma.loan.count({ where });
  console.log('exporting', count, 'loans with totalDebt >=', minDebt);
  const job = await prisma.job.create({ data: { type: 'EXPORT', status: 'PENDING', snapshotId: snap.id, total: count } });
  const t0 = Date.now();
  await runExportJob(job.id, { snapshotId: snap.id, minDebt });
  const done = await prisma.job.findUnique({ where: { id: job.id } });
  console.log('JOB', done?.status, '| progress', done?.progress, '| resultPath', done?.resultPath, '| ', Math.round((Date.now()-t0)/1000)+'s');
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
