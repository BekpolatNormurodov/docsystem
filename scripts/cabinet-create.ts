// Step-by-step claim-creation probe (reuses stored session, no signing). Learns
// each step's required payload from the server's 400 validation messages.
// SAFE: only creates/reads a DRAFT and calculates fees — never save-suit, never
// send-to-court. Cleans up any draft it creates.
//   npx tsx scripts/cabinet-create.ts [account=311976765]
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch, createDraft, deleteDraft, listDrafts } from '../src/lib/cabinet/api';
import { prisma } from '../src/lib/db';

async function main() {
  const account = process.argv[2] ?? '311976765';
  const s = await getStoredCabinetSession(account);
  console.log(`(stored session ${account}, no signing)\n`);

  // Step 1 — draft create: probe the required shape.
  console.log('STEP 1  draft-create — probing required fields:');
  for (const body of [{}, { type: 'CIVIL' }, { caseType: 'CIVIL' }, { category: 'CIVIL' }]) {
    const r = await createDraft(s, body);
    console.log(`  ${JSON.stringify(body).padEnd(26)} -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    if (r.ok && (r.json?.id || r.json?.data?.id)) {
      const id = r.json.id ?? r.json.data.id;
      console.log(`  ✅ draft created id=${id} — cleaning up`);
      const del = await deleteDraft(s, id);
      console.log(`  deleteDraft -> ${del.status}`);
      break;
    }
  }

  // Step 2 — calc-duties: probe params.
  console.log('\nSTEP 2  calc-duties-by-params — probing:');
  for (const body of [{}, { amount: 10000000 }, { sum: 10000000, caseType: 'CIVIL' }]) {
    const r = await cabinetFetch(s, '/api/cabinet/case/calc-duties-by-params', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, withVCC: true }),
    });
    console.log(`  ${JSON.stringify(body).padEnd(40)} -> ${r.status} ${JSON.stringify(r.json).slice(0, 180)}`);
  }

  const drafts = await listDrafts(s);
  console.log('\ndraft-list now:', drafts.status, JSON.stringify(drafts.json).slice(0, 120));
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
