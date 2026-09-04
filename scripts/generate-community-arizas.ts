/**
 * generate-community-arizas.ts — «Ariza yaratish» ni SCRIPT orqali ishga tushiradi
 * (COMMUNITY, arizaOnly). App tugmasi bilan aynan bir xil: PENDING `PACKET` job yaratadi,
 * ishlab turgan worker uni oladi va har case'ning courtId'si bo'yicha arizani yasab,
 * arizaAt'ni belgilaydi. Sud reassign'dan keyin ishlatiladi (A→Uchtepa, qolgani→Yuqorichirchiq).
 *
 * Qamrov = «Ariza yaratish» bilan bir xil: firm=COMMUNITY, arizaAt=null, totalDebt>0.
 *
 *   node --import tsx scripts/generate-community-arizas.ts          # eligible sonini ko'rsatadi (job yaratmaydi)
 *   node --import tsx scripts/generate-community-arizas.ts --go     # job yaratadi (worker qayta ishlaydi)
 */
import { prisma } from '../src/lib/db';

const GO = process.argv.includes('--go');

async function main() {
  const firm = await prisma.firm.findFirst({ where: { shortName: { contains: 'COMMUNITY' } } });
  if (!firm) throw new Error('COMMUNITY firmasi topilmadi');

  const where = { firmId: firm.id, arizaAt: null, totalDebt: { gt: 0 } };
  const total = await prisma.arizaCase.count({ where });
  console.log(`Firma: ${firm.shortName} (id ${firm.id})`);
  console.log(`«Ariza yaratish» eligible (arizaAt=null, qarz>0): ${total} ta`);
  if (total === 0) { console.log('Yaratiladigan yangi ariza yo‘q.'); await prisma.$disconnect(); return; }

  if (!GO) { console.log('\nJob YARATILMADI. Ishga tushirish uchun `--go` qo‘shing.'); await prisma.$disconnect(); return; }

  const job = await prisma.job.create({
    data: {
      type: 'PACKET', status: 'PENDING', total,
      // «Arizani tayyorlash»: faqat ariza, talabnoma PDF'siz. Snapshot/court berilmaydi —
      // har case o'z courtId'sini ishlatadi (reassign qilingan).
      params: { firmId: firm.id, arizaOnly: true, talabnomaPdf: false } as never,
    },
  });
  console.log(`\n✅ Job yaratildi: id=${job.id}, total=${total}. Worker qayta ishlamoqda.`);
  console.log(`Progress: SELECT status,progress,total FROM Job WHERE id=${job.id};`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
