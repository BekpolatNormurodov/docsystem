// Drive calc-duties-by-params to a real state-fee (davlat boji) computation for a
// civil first-instance money suit. Stored session, read-only calc.
//   npx tsx scripts/cabinet-calc.ts [amount=10000000]
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';
import { prisma } from '../src/lib/db';

async function main() {
  const amount = Number(process.argv[2] ?? 10000000);
  const s = await getStoredCabinetSession('311976765');
  const bases = [
    { instance: 'FIRST', claim_type: 'CIVIL', claim_kind: 'SUIT', amount, withVCC: true },
    { instance: 'FIRST', claim_type: 'CIVIL', claim_kind: 'SUIT', claim_amount: amount, withVCC: true },
    { instance: 'FIRST', claim_type: 'CIVIL', claim_kind: 'MATERIAL', amount, withVCC: true },
  ];
  for (const body of bases) {
    const r = await cabinetFetch(s, '/api/cabinet/case/calc-duties-by-params', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    console.log(`${r.status}  ${JSON.stringify(body)}\n   -> ${JSON.stringify(r.json).slice(0, 300)}\n`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
