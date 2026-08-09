import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';
import { prisma } from '../src/lib/db';

async function main() {
  const s = await getStoredCabinetSession('311976765');
  const types = ['CIVIL', 'ECONOMIC', 'PROPERTY', 'NON_PROPERTY', 'MATERIAL', 'PROPERTY_CLAIM', 'MONETARY', 'GENERAL', 'ADMINISTRATIVE'];
  for (const ct of types) {
    const r = await cabinetFetch(s, '/api/cabinet/case/calc-duties-by-params', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: 'FIRST', claim_type: ct, amount: 10000000, withVCC: true }),
    });
    console.log(`claim_type=${ct.padEnd(16)} -> ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
