// Dump read-only backend reference data behind the claim wizard + look up a paid
// state-fee invoice by receipt number. Reuses the STORED cabinet session (no
// signing); falls back to E-IMZO login if none/expired.
//   npx tsx scripts/cabinet-explore.ts [account=311976765] [receiptNumber]
import fs from 'node:fs/promises';
import path from 'node:path';
import { getStoredCabinetSession, authenticateCabinet } from '../src/lib/cabinet/session';
import { SessionExpiredError } from '../src/lib/session-store';
import { cabinetFetch } from '../src/lib/cabinet/api';
import { prisma } from '../src/lib/db';
import type { CabinetSession } from '../src/lib/cabinet/oneid';

const GETS: [string, string][] = [
  ['user', '/api/cabinet/user/get'],
  ['categories', '/api/cabinet/guide/categories'],
  ['document-types-list', '/api/cabinet/guide/document-types-list'],
  ['duty-reasons', '/api/cabinet/general-manuals/duty-reasons'],
  ['min-wages', '/api/cabinet/general-manuals/current-minimum-wages'],
  ['vcc-fee', '/api/cabinet/general-manuals/current-fee-by-type/VCC'],
  ['draft-list', '/api/cabinet/pub-user-draft-cases/list'],
  ['conflict-cases', '/api/cabinet/case/conflict/all-cases'],
];

async function main() {
  const account = process.argv[2] ?? '311976765';
  const receipt = process.argv[3] ?? '262196086404';

  let s: CabinetSession;
  try { s = await getStoredCabinetSession(account); console.log(`(reusing stored session for ${account}, no signing)\n`); }
  catch (e) {
    if (!(e instanceof SessionExpiredError)) throw e;
    console.log('No stored session — signing in...\n');
    s = await authenticateCabinet(process.argv[2]);
  }

  const dir = path.join(process.cwd(), 'exports', 'cabinet-explore');
  await fs.mkdir(dir, { recursive: true });
  for (const [name, p] of GETS) {
    try {
      const r = await cabinetFetch(s, p);
      const j = r.json;
      const arr = Array.isArray(j) ? j : Array.isArray(j?.content) ? j.content : Array.isArray(j?.data) ? j.data : null;
      console.log(`${r.status}  ${name.padEnd(22)} ${arr ? `[${arr.length}] ${JSON.stringify(arr[0] ?? {}).slice(0, 140)}` : JSON.stringify(j).slice(0, 150)}`);
      await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(j, null, 2));
    } catch (e: any) { console.log(`ERR ${name}: ${e.message}`); }
  }

  // Look up the paid invoice by receipt number — probe body shapes.
  console.log(`\n--- find-by-receipt-number for ${receipt} ---`);
  for (const body of [{ receiptNumber: receipt }, { number: receipt }, { receipt_number: receipt }, { serialNumber: receipt }]) {
    const r = await cabinetFetch(s, '/api/cabinet/guide/find-by-receipt-number', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const txt = JSON.stringify(r.json);
    const hit = r.ok && r.json && txt !== 'null' && txt !== '{}' && txt !== '[]';
    console.log(`  ${JSON.stringify(body).padEnd(34)} -> ${r.status} ${hit ? '✅ ' + txt.slice(0, 240) : txt.slice(0, 90)}`);
    if (hit) { await fs.writeFile(path.join(dir, 'invoice.json'), JSON.stringify(r.json, null, 2)); break; }
  }
  console.log(`\nSaved -> ${dir}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
