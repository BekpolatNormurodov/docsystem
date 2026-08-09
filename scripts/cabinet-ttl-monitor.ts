// Measure the REAL cabinet session-token TTL: poll the stored token's liveness
// every 20 min until the server rejects it (401/403), then report how long it
// lived. Uses the stored token directly (does not re-sign, does not mutate the
// session row until death). Logs to exports/cabinet-ttl.log.
//   npx tsx scripts/cabinet-ttl-monitor.ts [account=311976765] [intervalMin=20]
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { CABINET } from '../src/lib/cabinet/config';
import { markSessionExpired } from '../src/lib/session-store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ping(token: string): Promise<number> {
  try {
    const res = await fetch(`${CABINET.base_url}/api/cabinet/user/get`, {
      headers: { accept: 'application/json', 'X-AUTH-TOKEN': token },
    });
    return res.status;
  } catch { return 0; } // network hiccup — not an expiry
}

async function main() {
  const account = process.argv[2] ?? '311976765';
  const intervalMs = Number(process.argv[3] ?? 20) * 60 * 1000;
  const logFile = path.join(process.cwd(), 'exports', 'cabinet-ttl.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (m: string) => { const line = `${new Date().toISOString()}  ${m}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };

  const row = await prisma.externalSession.findUnique({ where: { provider_account: { provider: 'CABINET', account } } });
  if (!row) { console.log('No stored CABINET session. Run cabinet-auth first.'); return; }
  const token = row.accessToken;
  const born = row.createdAt.getTime();
  log(`TTL monitor start: account=${account} token=${token.slice(0, 12)}… created=${row.createdAt.toISOString()} interval=${intervalMs / 60000}min`);

  for (let i = 0; ; i++) {
    const status = await ping(token);
    const ageH = ((Date.now() - born) / 3600000).toFixed(2);
    if (status === 200) {
      log(`check#${i}: 200 alive — age ${ageH}h`);
    } else if (status === 401 || status === 403) {
      log(`check#${i}: ${status} REJECTED — cabinet session TTL ≈ ${ageH}h (died between ${((Date.now() - born - intervalMs) / 3600000).toFixed(2)}h and ${ageH}h)`);
      await markSessionExpired('CABINET', account);
      log('marked session EXPIRED in DB. Done.');
      break;
    } else {
      log(`check#${i}: status ${status} (transient?) — age ${ageH}h, will retry`);
    }
    await sleep(intervalMs);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
