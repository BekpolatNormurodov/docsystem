// Probe find-by-receipt-number body until the paid state-fee invoice resolves.
//   npx tsx scripts/cabinet-invoice.ts <receiptNumber> [account=311976765]
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';
import { prisma } from '../src/lib/db';

async function main() {
  const receipt = process.argv[2] ?? '262196086404';
  const account = process.argv[3] ?? '311976765';
  const s = await getStoredCabinetSession(account);
  const statuses = ['PAID', 'NOT_USED', 'UNUSED', 'NEW', 'ACTIVE', 'VALID', 'CONFIRMED', 'SUCCESS', 1, 0];
  for (const st of statuses) {
    const body = { receipt_number: receipt, invoiceStatus: st };
    const r = await cabinetFetch(s, '/api/cabinet/guide/find-by-receipt-number', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const txt = JSON.stringify(r.json);
    const hit = r.ok && txt !== 'null' && txt !== '{}' && txt !== '[]';
    console.log(`invoiceStatus=${String(st).padEnd(10)} -> ${r.status} ${hit ? '✅ ' + txt : txt.slice(0, 100)}`);
    if (hit) break;
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
