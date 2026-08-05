import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { runExportJob } from '../src/lib/export-arizas';
(async () => {
  const snap = await prisma.snapshot.findFirst({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' } });
  if (!snap) throw new Error('no READY snapshot');
  const cnt = await prisma.loan.count({ where: { snapshotId: snap.id, branchCode: '05557' } });
  console.log('export branch 05557:', cnt, 'loans, snap', snap.reportDate.toISOString().slice(0, 10));
  const job = await prisma.job.create({ data: { type: 'EXPORT', status: 'PENDING', snapshotId: snap.id, total: cnt } });
  await runExportJob(job.id, { snapshotId: snap.id, branches: ['05557'] });
  const d = await prisma.job.findUnique({ where: { id: job.id } });
  console.log('RESULT', d?.status, d?.progress, d?.resultPath);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
