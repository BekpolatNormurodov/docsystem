import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
(async()=>{
  const id = 33; // 2025-01-04 duplicate
  const s = await prisma.snapshot.findUnique({where:{id}});
  if(!s){console.log('yo\'q');return;}
  console.log('o\'chirilmoqda:', id, s.reportDate.toISOString().slice(0,10), s.rowCount);
  const del = await prisma.loan.deleteMany({where:{snapshotId:id}});
  await prisma.snapshot.delete({where:{id}});
  for(const f of [`uploads/${id}.xlsx`, `uploads/${id}-exclude.xlsx`]){
    try{ fs.rmSync(path.join(process.cwd(),f),{force:true}); }catch{}
  }
  console.log('o\'chirildi. loans:', del.count);
  const left = await prisma.snapshot.findMany({orderBy:{reportDate:'desc'},select:{id:true,reportDate:true,rowCount:true}});
  console.log('qolgan:', left.map(x=>`${x.id}:${x.reportDate.toISOString().slice(0,10)}(${x.rowCount})`).join(', '));
})().finally(()=>prisma.$disconnect());
