// Single-shot cabinet token liveness check — appends one line to
// exports/cabinet-ttl.log. Designed to be run repeatedly by the OS scheduler
// (Windows Task Scheduler), so measurement survives sleep/terminal-close.
// Uses the reliable token-check endpoint. Marks the DB session EXPIRED on death.
//   npx tsx scripts/cabinet-ttl-check.ts
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { CABINET } from '../src/lib/cabinet/config';
import { markSessionExpired } from '../src/lib/session-store';

const CHECK_URL = `${CABINET.xsud_url}/auth/api/token/check`;

async function main() {
  const account = '311976765';
  const logFile = path.join(process.cwd(), 'exports', 'cabinet-ttl.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const write = (m: string) => fs.appendFileSync(logFile, `${new Date().toISOString()}  ${m}\n`);

  const row = await prisma.externalSession.findUnique({ where: { provider_account: { provider: 'CABINET', account } } });
  if (!row) { write('no stored session'); return; }
  const ageH = ((Date.now() - row.createdAt.getTime()) / 3600000).toFixed(2);

  let status = 0;
  try {
    const res = await fetch(CHECK_URL, { headers: { accept: 'application/json', 'X-AUTH-TOKEN': row.accessToken } });
    status = res.status;
  } catch (e: any) { write(`age ${ageH}h  network-error ${e.message}`); return; }

  if (status === 200) write(`age ${ageH}h  200 alive`);
  else if (status === 401 || status === 403) {
    write(`age ${ageH}h  ${status} DIED — cabinet session max TTL ≈ ${ageH}h`);
    await markSessionExpired('CABINET', account);
  } else write(`age ${ageH}h  status ${status} (transient?)`);
  await prisma.$disconnect();
}
main().catch((e) => { try { fs.appendFileSync(path.join(process.cwd(), 'exports', 'cabinet-ttl.log'), `${new Date().toISOString()}  ERR ${e.message}\n`); } catch {} process.exit(1); });
