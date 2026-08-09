// Authenticate to cabinet.sud.uz via E-IMZO and PERSIST the session to the DB
// (ExternalSession). After this, data-pull code reuses the stored token until it
// expires — no re-signing per request.
//   npx tsx scripts/cabinet-auth.ts [keySelector]
import { authenticateCabinet } from '../src/lib/cabinet/session';
import { prisma } from '../src/lib/db';

async function main() {
  console.log('Signing — TYPE THE KEY PASSWORD IN THE E-IMZO WINDOW...\n');
  const s = await authenticateCabinet(process.argv[2]);
  console.log('✅ cabinet session saved to DB');
  console.log('   org   :', s.key.info.org, '| STIR:', s.key.info.tin);
  console.log('   user  :', s.user.username, '| token:', s.token);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
