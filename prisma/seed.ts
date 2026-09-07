import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/core/password';
import { FIRMS_SEED } from '../src/core/firms.seed';
import { ensureSeedCourt } from '../src/lib/court-routing';

async function main() {
  const username = process.env.DOCSYSTEM_ADMIN_USERNAME || 'admin';
  const password = process.env.DOCSYSTEM_ADMIN_PASSWORD || 'admin';
  await prisma.admin.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: await hashPassword(password) },
  });
  for (const f of FIRMS_SEED) {
    // update (not {}) so re-seeding backfills rekvizit onto firms that were created bare.
    await prisma.firm.upsert({ where: { code: f.code }, update: f, create: f });
  }
  // Sudlar: default Uchtepa sudi (barcha firmalar) + Bright uchun 2-sud (Yuqorichirchiq) va Bright'ni
  // ikkala sudga biriktirish. Har deployda ishlaydi — endi admin «Sudlar»ni ochishini kutmaydi
  // (ilgari faqat o'sha sahifa lazy seed qilardi → serverda Court bo'sh qolar edi). Idempotent:
  // Court to'lgach create'ni o'tkazib yuboradi, `court_seed_bright` bayrog'i qayta ishlashdan saqlaydi.
  await ensureSeedCourt();

  // NOTO'G'RI TASHXIS TUZATILDI (2026-09-07). Bir necha soat davomida Yuqorichirchiq sudi
  // «ADOLAT'da elektron ariza qabul qilmaydi» deb yopiq turdi — save-suit «Танланган суд
  // учун канцелярия ходими фойдаланувчиси киритилмаган» qaytargani uchun. Aslida sabab
  // BIZDA edi: CABINET_COURT_IDS.YUQORICHIRCHIQ_CIVIL da eskirgan GUID turgan, portalning
  // sudlar ro'yxatida bunday id UMUMAN yo'q edi — portal sudni topolmagani uchun uning
  // kantselyariyasini ham topolmagan. To'g'ri GUID qo'yilgach sud oddiy ishlaydi.
  //
  // Shuning uchun o'sha yopiq belgini olib tashlaymiz. Faqat AYNAN o'sha avtomatik yozuvni
  // tozalaymiz — operator qo'lda boshqa sabab yozgan bo'lsa, unga tegilmaydi.
  await prisma.court.updateMany({
    where: { cabinetNote: { contains: 'kantselyariya xodimi biriktirilmagan' } },
    data: { cabinetEnabled: true, cabinetNote: null },
  });

  console.log('seeded admin + firms + courts');
}

main().finally(() => prisma.$disconnect());
