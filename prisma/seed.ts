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
  console.log('seeded admin + firms + courts');
}

main().finally(() => prisma.$disconnect());
