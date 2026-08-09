// Authenticate to xat.hippo.uz via E-IMZO and PERSIST the 7-day session to the DB
// (ExternalSession). Data-pull code then reuses the stored token until expiry.
//   npx tsx scripts/hippo-auth.ts [keySelector=farrux]
import { authenticateHippo } from '../src/lib/hippo/session';
import { prisma } from '../src/lib/db';

async function main() {
  console.log('Signing — TYPE THE KEY PASSWORD IN THE E-IMZO WINDOW...\n');
  const s = await authenticateHippo(process.argv[2] ?? 'farrux');
  const expiresAt = new Date(Date.now() + s.expiresIn * 1000);
  console.log('✅ hippo session saved to DB');
  console.log('   org     :', s.key.info.org, '| STIR:', s.key.info.tin);
  console.log('   expires :', expiresAt.toISOString(), `(${Math.round(s.expiresIn / 86400)}d)`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
