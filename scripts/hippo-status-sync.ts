// Pull xat.hippo talabnoma/delivery statuses for a firm into ClientCaseStatus.
// Reuses a stored hippo session; if none/expired, logs in via E-IMZO (sign).
//   npx tsx scripts/hippo-status-sync.ts [branchCode=12842]
import { getStoredHippoSession, authenticateHippo } from '../src/lib/hippo/session';
import { ingestHippoStatuses } from '../src/lib/hippo/status-ingest';
import { SessionExpiredError } from '../src/lib/session-store';
import { firmByBranch } from '../src/lib/firms';
import { prisma } from '../src/lib/db';

async function main() {
  const branchCode = process.argv[2] ?? '12842';
  const firm = firmByBranch(branchCode);
  if (!firm) throw new Error(`unknown firm branchCode ${branchCode}`);

  let session;
  try { session = await getStoredHippoSession(firm.stir); console.log(`(stored hippo session ${firm.stir}, no signing)`); }
  catch (e) {
    if (!(e instanceof SessionExpiredError)) throw e;
    console.log('No stored hippo session — signing in (type key password)...');
    session = await authenticateHippo(firm.hippoKey, firm.stir);
  }

  const res = await ingestHippoStatuses(session, branchCode);
  console.log(`\nfirm ${branchCode} ${firm.name}: ${res.totalMails} hippo mails stored`);
  console.log(`  matched to portfolio: ${res.matched} (${res.totalMails ? (res.matched / res.totalMails * 100).toFixed(0) : 0}%) | unmatched: ${res.unmatched}`);
  console.log('  by status:');
  for (const [st, n] of Object.entries(res.byStatus).sort((a, b) => b[1] - a[1]))
    console.log(`    ${String(n).padStart(4)}  ${st}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
