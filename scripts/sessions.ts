// Show the status of every stored external session (hippo + cabinet): which are
// ACTIVE and which NEED_REAUTH (E-IMZO re-login). Read-only, no signing.
//   npx tsx scripts/sessions.ts
import { sessionStatuses } from '../src/lib/session-store';
import { prisma } from '../src/lib/db';

async function main() {
  const rows = await sessionStatuses();
  if (!rows.length) { console.log('No stored sessions yet. Run cabinet-auth / hippo-auth first.'); }
  console.log('PROVIDER  ACCOUNT         STATUS        EXPIRES              ORG');
  for (const r of rows) {
    console.log(
      `${r.provider.padEnd(9)} ${String(r.account).padEnd(15)} ${(r.needsReauth ? 'NEEDS_REAUTH' : 'ACTIVE').padEnd(13)} ` +
      `${(r.expiresAt ? new Date(r.expiresAt).toISOString().slice(0, 16) : '—').padEnd(20)} ${r.org ?? ''}`,
    );
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
