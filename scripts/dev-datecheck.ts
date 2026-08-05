import 'dotenv/config';
import { prisma } from '../src/lib/db';
async function main() {
  const l = await prisma.loan.findFirst({ where: { ldId: '61717' } });
  console.log('typed dateToCr:', l?.dateToCr, '| dateClose:', l?.dateClose);
  const raw = l?.raw as any;
  console.log('raw.date_to_cr:', JSON.stringify(raw?.date_to_cr), '| raw.date_close:', JSON.stringify(raw?.date_close), '| raw.date_rep:', JSON.stringify(raw?.date_rep));
  const nullDates = await prisma.loan.count({ where: { snapshotId: l?.snapshotId, dateToCr: null } });
  const total = await prisma.loan.count({ where: { snapshotId: l?.snapshotId } });
  console.log('loans with NULL dateToCr:', nullDates, '/', total);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
