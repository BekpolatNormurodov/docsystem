import 'dotenv/config';
import { prisma } from '../src/lib/db';
async function main() {
  const all = await prisma.snapshot.findMany({ select: { id:true, reportDate:true, rowCount:true, sourceFileName:true }});
  console.log('ALL SNAPSHOTS:', JSON.stringify(all));
  const byDate = await prisma.snapshot.findUnique({ where: { reportDate: new Date('2026-07-09') } });
  console.log('findUnique(2026-07-09):', byDate ? `id=${byDate.id}` : 'NULL');
  if (byDate) {
    const c = await prisma.loan.count({ where: { snapshotId: byDate.id } });
    console.log('loans for that snapshot.id:', c);
  }
  const totalLoans = await prisma.loan.count();
  const grp = await prisma.loan.groupBy({ by:['snapshotId'], _count:true });
  console.log('TOTAL loans in db:', totalLoans, 'bySnapshot:', JSON.stringify(grp));
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
