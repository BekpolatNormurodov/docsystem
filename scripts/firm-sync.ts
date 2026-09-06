// Full real-status sync for ONE firm: cabinet (login+status+detail/exact-pinfl) +
// hippo (login+delivery status). Reuses stored sessions when valid, else prompts
// E-IMZO. Run pipeline-bridge afterwards (or pass --bridge).
//   npx tsx scripts/firm-sync.ts <branchCode> [--bridge]
import { firmByBranch } from '../src/lib/firms';
import { authenticateCabinet, getStoredCabinetSession } from '../src/lib/cabinet/session';
import { ingestCabinetStatuses } from '../src/lib/cabinet/status-ingest';
import { ingestCabinetDetails } from '../src/lib/cabinet/detail-ingest';
import { authenticateHippo, getStoredHippoSession } from '../src/lib/hippo/session';
import { ingestHippoStatuses } from '../src/lib/hippo/status-ingest';
import { SessionExpiredError } from '../src/lib/session-store';
import { prisma } from '../src/lib/db';

async function main() {
  const branchCode = process.argv[2];
  if (!branchCode) throw new Error('usage: firm-sync <branchCode>');
  const firm = firmByBranch(branchCode);
  if (!firm) throw new Error(`unknown firm ${branchCode}`);
  console.log(`=== ${firm.name} (${branchCode}, STIR ${firm.stir}) ===\n`);

  // --- CABINET ---
  let cab;
  try { cab = await getStoredCabinetSession(firm.stir); console.log('cabinet: stored session'); }
  catch (e) { if (!(e instanceof SessionExpiredError)) throw e; console.log(`cabinet: SIGN with ${firm.cabinetKey} key...`); cab = await authenticateCabinet(firm.cabinetKey, firm.stir); }
  const cs = await ingestCabinetStatuses(cab, branchCode);
  console.log(`  cabinet cases: ${cs.totalCases}, matched ${cs.matched}`);
  const cd = await ingestCabinetDetails(cab, branchCode);
  console.log(`  details: ${cd.fetched} fetched, ${cd.withPinfl} with exact PINFL`);

  // --- HIPPO ---
  let hip;
  try { hip = await getStoredHippoSession(firm.stir); console.log('hippo: stored session'); }
  catch (e) { if (!(e instanceof SessionExpiredError)) throw e; console.log(`hippo: SIGN with ${firm.hippoKey} key...`); hip = await authenticateHippo(firm.hippoKey, firm.stir); }
  const hs = await ingestHippoStatuses(hip, branchCode);
  console.log(`  hippo mails: ${hs.totalMails}, matched ${hs.matched}`);

  console.log(`\n✅ ${firm.name} synced. Run: npx tsx scripts/pipeline-bridge.ts`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
