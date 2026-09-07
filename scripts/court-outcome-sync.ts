// Sudga yuborilgan ishlarning ADOLAT'dagi haqiqiy natijasini bazaga qaytaradi.
// Rad etilganlar (DECLINED) qayta yuboriladigan holatga o'tkaziladi.
//
//   npx tsx scripts/court-outcome-sync.ts            — sessiyasi bor barcha firmalar
//   npx tsx scripts/court-outcome-sync.ts 2          — faqat firmaId=2
import { prisma } from '../src/lib/db';
import { syncCourtOutcomes } from '../src/lib/cabinet/outcome-sync';

async function main() {
  const only = Number(process.argv[2]);
  const firms = await prisma.firm.findMany({
    where: Number.isInteger(only) && only > 0 ? { id: only } : {},
    select: { id: true, shortName: true },
    orderBy: { id: 'asc' },
  });

  for (const f of firms) {
    try {
      const r = await syncCourtOutcomes(f.id);
      if (r.checked === 0) continue;
      console.log(
        `${r.firm.padEnd(34)} tekshirildi ${r.checked}  ·  portalda ${r.matched}  ·  ` +
        `RAD ETILGAN ${r.declined}  ·  qabul ${r.accepted}  ·  topilmadi ${r.missing}`,
      );
    } catch (e: any) {
      console.log(`${f.shortName.padEnd(34)} o'tkazib yuborildi: ${e.message?.slice(0, 90)}`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
