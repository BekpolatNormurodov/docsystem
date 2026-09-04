/**
 * reassign-community-court.ts — COMMUNITY firmasi case'larida sudni ISM bo'yicha qayta
 * biriktiradi:  F.I.O «A» bilan boshlansa → «Uchtepa …» (eski),  qolgani → «Yuqorichirchiq …».
 *
 * Ariza ichidagi sud nomi packet yaratilganda case.courtId'dan olinadi (konveyer-packet.ts),
 * shuning uchun courtId'ni o'zgartirib + arizaAt'ni tozalab qo'yamiz — so'ng app'dagi «Ariza
 * yaratish» arizani YANGI sud bilan boshidan yasaydi.
 *
 * XAVFSIZ: standart DRY-RUN (faqat sanaydi). Haqiqatan yozish uchun `--apply`.
 * Standart faqat SUDGA HALI YUBORILMAGAN (courtSentAt = null) case'lar; hammasi uchun `--all`.
 *
 *   node --import tsx scripts/reassign-community-court.ts            # dry-run (yuborilmaganlar)
 *   node --import tsx scripts/reassign-community-court.ts --apply    # yozadi
 *   node --import tsx scripts/reassign-community-court.ts --all      # allaqachon yuborilganlarni ham
 */
import { prisma } from '../src/lib/db';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

// Ismning birinchi HARFI (bosh probel/apostrof/tinish tashlanadi) «A» (lotin) yoki «А» (kirill)?
const startsWithA = (name: string): boolean => {
  const s = (name || '').normalize('NFKC').replace(/^[^\p{L}]+/u, '');
  const c = s.charAt(0).toUpperCase();
  return c === 'A' || c === 'А'; // Latin A / Cyrillic А
};

async function courtBy(keyword: string) {
  const cs = await prisma.court.findMany({ where: { shortName: { contains: keyword } } });
  if (cs.length === 0) throw new Error(`Sud topilmadi: «${keyword}»`);
  if (cs.length > 1) throw new Error(`«${keyword}» ga bir nechta sud mos: ${cs.map((c) => c.shortName).join(', ')} — aniqrog'ini yozing`);
  return cs[0];
}

async function main() {
  const firm = await prisma.firm.findFirst({ where: { shortName: { contains: 'COMMUNITY' } } });
  if (!firm) throw new Error('COMMUNITY firmasi topilmadi');
  const uchtepa = await courtBy('Uchtepa');
  const yuqori = await courtBy('Yuqorichirchiq');
  console.log(`Rejim: ${APPLY ? 'APPLY (yoziladi!)' : 'DRY-RUN'} | qamrov: ${ALL ? 'HAMMA case' : 'faqat yuborilmagan (courtSentAt=null)'}`);
  console.log(`Firma: ${firm.shortName} (id ${firm.id})`);
  console.log(`A → «${uchtepa.shortName}» (id ${uchtepa.id}) | qolgani → «${yuqori.shortName}» (id ${yuqori.id})\n`);

  const where = { firmId: firm.id, ...(ALL ? {} : { courtSentAt: null }) };
  const cases = await prisma.arizaCase.findMany({ where, select: { id: true, clientName: true, courtId: true } });

  const aIds: number[] = [], restIds: number[] = [];
  for (const c of cases) (startsWithA(c.clientName || '') ? aIds : restIds).push(c.id);
  // Allaqachon to'g'ri biriktirilganlarni ham sanaймиз (o'zgarish nechta).
  const aNeedsChange = cases.filter((c) => startsWithA(c.clientName || '') && c.courtId !== uchtepa.id).length;
  const restNeedsChange = cases.filter((c) => !startsWithA(c.clientName || '') && c.courtId !== yuqori.id).length;

  console.log(`Jami case: ${cases.length}`);
  console.log(`  A bilan boshlanadi → Uchtepa: ${aIds.length} ta (o'zgaradi: ${aNeedsChange})`);
  console.log(`  qolgani → Yuqorichirchiq: ${restIds.length} ta (o'zgaradi: ${restNeedsChange})`);

  if (!APPLY) { console.log('\nDRY-RUN — hech nima yozilmadi. Sonlar to‘g‘ri bo‘lsa `--apply` bilan qayta ishga tushiring.'); await prisma.$disconnect(); return; }

  // courtId'ni qo'yamiz + arizaAt=null (arizani yangi sud bilan qayta yaratish uchun).
  const r1 = await prisma.arizaCase.updateMany({ where: { id: { in: aIds } }, data: { courtId: uchtepa.id, arizaAt: null } });
  const r2 = await prisma.arizaCase.updateMany({ where: { id: { in: restIds } }, data: { courtId: yuqori.id, arizaAt: null } });
  console.log(`\n✅ Bajarildi: Uchtepa'ga=${r1.count}, Yuqorichirchiq'ga=${r2.count}. arizaAt tozalandi — endi app'da «Ariza yaratish» ni bosing (arizalar yangi sud bilan qayta yasaladi).`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
