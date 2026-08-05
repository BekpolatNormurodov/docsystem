import 'dotenv/config';
import { prisma } from '../src/lib/db';
async function main() {
  const snaps = await prisma.snapshot.findMany();
  for (const s of snaps) {
    const loans = await prisma.loan.count({ where: { snapshotId: s.id } });
    const people = (await prisma.loan.groupBy({ by: ['pinfl'], where: { snapshotId: s.id } })).length;
    const byBranch = await prisma.loan.groupBy({ by: ['branchCode'], where: { snapshotId: s.id }, _count: true });
    console.log(`Snapshot ${s.id} date=${s.reportDate.toISOString().slice(0,10)} status=${s.status} rowCount=${s.rowCount} totalDebt=${s.totalDebt}`);
    console.log(`  loans=${loans} distinctPinfl=${people} branches=${byBranch.map(b=>b.branchCode+':'+b._count).join(' ')}`);
  }
  const sample = await prisma.loan.findFirst({ where: { pinfl: { not: null } } });
  console.log('sample loan:', JSON.stringify({ pinfl: sample?.pinfl, name: sample?.clientName, branch: sample?.branchCode, ldId: sample?.ldId, total: sample?.totalDebt, addr: sample?.postAddress, rawKeys: sample?.raw ? Object.keys(sample.raw as any).length : 0 }));
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
