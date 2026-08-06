import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { runExportJob } from '../src/lib/export-arizas';
(async () => {
  const snap = await prisma.snapshot.findFirst({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' } });
  if (!snap) throw new Error('no snapshot');
  // excluded clients with 2+ loans at ONE firm
  const g = await prisma.loan.groupBy({
    by: ['pinfl', 'branchCode', 'clientName'],
    where: { snapshotId: snap.id, excluded: true },
    _count: true,
    _sum: { totalDebt: true },
  });
  const multi = g.filter((x) => x._count >= 2).sort((a, b) => b._count - a._count);
  console.log('excluded loans:', await prisma.loan.count({ where: { snapshotId: snap.id, excluded: true } }));
  console.log('arizas (distinct client x firm):', g.length, '| multi-contract arizas:', multi.length);
  const sample = multi[0];
  console.log('SAMPLE multi:', sample?.clientName, '| firm', sample?.branchCode, '| contracts', sample?._count, '| sum', String(sample?._sum.totalDebt));
  // run the export
  const job = await prisma.job.create({ data: { type: 'EXPORT', status: 'PENDING', snapshotId: snap.id, total: g.length } });
  await runExportJob(job.id, { snapshotId: snap.id, onlyExcluded: true });
  const d = await prisma.job.findUnique({ where: { id: job.id } });
  console.log('EXPORT', d?.status, 'progress', d?.progress, d?.resultPath);
  console.log('SAMPLE_PINFL:' + sample?.pinfl);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
