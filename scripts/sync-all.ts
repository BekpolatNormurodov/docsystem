// Master refresh: for every firm with a stored session, re-pull cabinet (status +
// detail/exact-pinfl) + hippo statuses, then bridge everything into arizacase.
// Reuses stored sessions (NO signing). One command to reconnect the whole real DB.
//   npx tsx scripts/sync-all.ts
import { execSync } from 'node:child_process';
import { FIRMS } from '../src/lib/firms';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { ingestCabinetStatuses } from '../src/lib/cabinet/status-ingest';
import { ingestCabinetDetails } from '../src/lib/cabinet/detail-ingest';
import { getStoredHippoSession } from '../src/lib/hippo/session';
import { ingestHippoStatuses } from '../src/lib/hippo/status-ingest';
import { SessionExpiredError } from '../src/lib/session-store';
import { prisma } from '../src/lib/db';

async function main() {
  for (const f of FIRMS) {
    process.stdout.write(`\n${f.name} (${f.branchCode}): `);
    try {
      const s = await getStoredCabinetSession(f.stir);
      const cs = await ingestCabinetStatuses(s, f.branchCode);
      const cd = await ingestCabinetDetails(s, f.branchCode, { concurrency: 6 });
      process.stdout.write(`cabinet ${cs.totalCases} (pinfl ${cd.withPinfl})  `);
    } catch (e) { process.stdout.write(e instanceof SessionExpiredError ? 'cabinet: no session  ' : `cabinet ERR: ${(e as Error).message}  `); }
    try {
      const h = await getStoredHippoSession(f.stir);
      const hs = await ingestHippoStatuses(h, f.branchCode);
      process.stdout.write(`hippo ${hs.totalMails} (matched ${hs.matched})`);
    } catch (e) { process.stdout.write(e instanceof SessionExpiredError ? 'hippo: no session' : `hippo ERR: ${(e as Error).message}`); }
  }
  console.log('\n\n--- bridging into arizacase ---');
  console.log(execSync('npx tsx scripts/pipeline-bridge.ts', { cwd: process.cwd() }).toString());
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
