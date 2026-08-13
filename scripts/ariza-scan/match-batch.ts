import 'dotenv/config'; import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main(){
  const rows = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const doImport = process.argv.includes('--import');
  let ok=0, bad=0, withCase=0, imported=0;
  console.log('№ reg   | sahifa | qarzdor                              | firma  | PINFL          | portfel | pipeline case');
  console.log('-'.repeat(120));
  for(const r of rows){
    const loan = await prisma.loan.findFirst({ where:{ pinfl:r.pinfl }, select:{ clientName:true, branchCode:true } });
    const acase = await prisma.arizaCase.findFirst({ where:{ pinfl:r.pinfl }, select:{ id:true, stage:true } });
    if(loan) ok++; else bad++;
    if(acase) withCase++;
    console.log(`${r.reg} | ${String(r.pages).padEnd(6)} | ${r.name.padEnd(36)} | ${r.firmKey.padEnd(6)} | ${r.pinfl} | ${loan?'✓':'✗ YOʻQ'.padEnd(4)}     | ${acase?`#${acase.id} ${acase.stage}`:'— (case yoʻq)'}`);
    if(doImport && loan && r.address){ const u=await prisma.loan.updateMany({where:{pinfl:r.pinfl},data:{postAddressUz:r.address}}); imported+=u.count; }
  }
  console.log('-'.repeat(120));
  console.log(`Jami ${rows.length} ariza | portfelda topildi: ${ok} | topilmadi: ${bad} | pipeline case bor: ${withCase}` + (doImport?` | manzil import: ${imported} loan`:''));
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);prisma.$disconnect();process.exit(1);});
