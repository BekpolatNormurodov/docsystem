// Learn the real claim structure from an already-submitted BRIGHT case, and find
// the calc-duties `instance` enum. Read-only (+ safe calc probes). Stored session.
//   npx tsx scripts/cabinet-inspect.ts [account=311976765]
import fs from 'node:fs/promises';
import path from 'node:path';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch, getConflictCases, getSuit } from '../src/lib/cabinet/api';
import { prisma } from '../src/lib/db';

async function main() {
  const account = process.argv[2] ?? '311976765';
  const s = await getStoredCabinetSession(account);
  const dir = path.join(process.cwd(), 'exports', 'cabinet-explore');
  await fs.mkdir(dir, { recursive: true });

  const cases = await getConflictCases(s);
  const arr: any[] = Array.isArray(cases.json) ? cases.json : cases.json?.content ?? cases.json?.data ?? [];
  console.log(`conflict cases: ${arr.length}`);
  const c0 = arr[0];
  console.log('first case keys:', c0 ? Object.keys(c0).join(', ') : '—');
  const claimId = c0?.claim_id ?? c0?.claimId ?? c0?.case_id;
  if (claimId) {
    const view = await getSuit(s, claimId);
    console.log(`\nconflict-suit-view/${claimId} -> ${view.status}`);
    await fs.writeFile(path.join(dir, 'suit-view-sample.json'), JSON.stringify(view.json, null, 2));
    const j = view.json ?? {};
    console.log('  top-level keys:', Object.keys(j).join(', ').slice(0, 300));
    if (j.instance || j.caseInstance) console.log('  instance =', j.instance ?? j.caseInstance);
  }

  console.log('\ncalc-duties-by-params — probing instance enum:');
  for (const instance of ['FIRST', 'FIRST_INSTANCE', 'CIVIL', 'ECONOMIC', 'APPEAL', 'CASSATION', 'GENERAL']) {
    const r = await cabinetFetch(s, '/api/cabinet/case/calc-duties-by-params', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance, amount: 10000000, withVCC: true }),
    });
    console.log(`  instance=${String(instance).padEnd(15)} -> ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
