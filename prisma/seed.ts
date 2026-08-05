import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/core/password';
import { FIRMS_SEED } from '../src/core/firms.seed';

async function main() {
  const username = process.env.DOCSYSTEM_ADMIN_USERNAME || 'admin';
  const password = process.env.DOCSYSTEM_ADMIN_PASSWORD || 'admin';
  await prisma.admin.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: await hashPassword(password) },
  });
  for (const f of FIRMS_SEED) {
    await prisma.firm.upsert({ where: { code: f.code }, update: {}, create: f });
  }
  console.log('seeded admin + firms');
}

main().finally(() => prisma.$disconnect());
