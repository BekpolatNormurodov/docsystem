// Are there duplicate (snapshotId, pinfl, firmId) ArizaCase rows? If yes, the new
// @@unique can't be pushed until they're merged. Report-only (no mutation).
import { prisma } from '@/lib/db';
const N=(x:any)=>Number(x);
async function main(){
  const dupes = await prisma.$queryRaw<{snapshotId:number,pinfl:string,firmId:number,c:bigint}[]>`
    SELECT snapshotId, pinfl, firmId, COUNT(*) c
    FROM ArizaCase
    WHERE pinfl IS NOT NULL
    GROUP BY snapshotId, pinfl, firmId
    HAVING COUNT(*) > 1
    ORDER BY c DESC
    LIMIT 20`;
  const [{ total }] = await prisma.$queryRaw<{total:bigint}[]>`SELECT COUNT(*) total FROM ArizaCase`;
  console.log(`ArizaCase rows: ${N(total)}`);
  console.log(`duplicate (snapshotId,pinfl,firmId) groups: ${dupes.length}${dupes.length===20?'+ (capped)':''}`);
  for(const d of dupes) console.log(`  snap=${d.snapshotId} firm=${d.firmId} pinfl=${d.pinfl} → ${N(d.c)} rows`);
  console.log(dupes.length===0 ? '\n✅ SAFE: `npm run db:push` will apply @@unique with no conflict.' : '\n⚠️ Must merge these before db:push.');
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
