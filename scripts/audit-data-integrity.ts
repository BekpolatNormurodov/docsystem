// Deeper source-data integrity scan (SQL, no fat rows) — flags loans that would
// produce a wrong/suspect document. Report-only.
import { prisma } from '@/lib/db';
const N=(x:any)=>Number(x);
async function main(){
  const snap = await prisma.snapshot.findFirst({ orderBy:{id:'desc'} });
  const sid = snap!.id;
  const [a] = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*) total,
      SUM(totalDebt < 0) negDebt,
      SUM(summKr < 0) negLoan,
      SUM(totalDebt > 10000000000) hugeDebt,
      SUM(pinfl IS NOT NULL AND CHAR_LENGTH(TRIM(pinfl)) <> 14) badPinflLen,
      SUM(pinfl IS NOT NULL AND pinfl REGEXP '[^0-9]') pinflNonDigit,
      SUM(dateToCr > CURDATE()) futureContract,
      SUM(dateToCr < '2000-01-01') ancientContract,
      SUM(rate < 0 OR rate > 200) crazyRate
    FROM Loan WHERE snapshotId=${sid} AND excluded=false`;
  console.log(`COURT-LIST loans: ${N(a.total)}`);
  const rowsOf = (o:any)=>Object.entries(o).filter(([k])=>k!=='total').map(([k,v])=>`  ${k}: ${N(v)}`);
  console.log(rowsOf(a).join('\n'));
  // pinfl shared by >1 distinct name (data entry error → wrong debtor identity)
  const shared = await prisma.$queryRaw<any[]>`
    SELECT pinfl, COUNT(DISTINCT clientName) c FROM Loan
    WHERE snapshotId=${sid} AND excluded=false AND pinfl IS NOT NULL
    GROUP BY pinfl HAVING COUNT(DISTINCT clientName) > 1 LIMIT 5`;
  console.log(`\npinfl with >1 distinct name: ${shared.length}${shared.length?' (sample)':''}`);
  for(const s of shared) console.log(`  ${s.pinfl}: ${N(s.c)} names`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
