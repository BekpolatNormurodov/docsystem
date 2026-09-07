// cabinet-api-skeleton/check-duty.ts
// FAQAT O'QISH: bizning da'vo turi uchun davlat boji QANCHA ekanini portaldan hisoblatadi.
//
// Savol: mikroqarz undirish da'vosi (111-toifa, DECREE, birinchi instansiya) bojdan ozodmi,
// yoki boj to'lanishi kerakmi? Buni taxmin qilmasdan portalning o'z kalkulyatoridan so'raymiz.
//   npx tsx cabinet-api-skeleton/check-duty.ts
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { prisma } from '../src/lib/db';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';

async function calc(session: any, body: Record<string, unknown>) {
  const r = await cabinetFetch(session, '/api/cabinet/case/calc-duties-by-params', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, json: r.json };
}

async function main() {
  const session = await getStoredCabinetSession('311976765');

  // Haqiqiy ishlarimizdan uchta xil summa — boj summaga bog'liqmi yoki yo'qmi ko'rish uchun.
  const amounts = [7301359.8, 36645901.36, 39694029.87];

  for (const amount of amounts) {
    for (const claim_kind of ['DECREE', 'SUIT']) {
      const body = { instance: 'FIRST', claim_type: 'CIVIL', claim_kind, amount, withVCC: true };
      const r = await calc(session, body);
      console.log(`${claim_kind.padEnd(7)} ${String(amount).padStart(14)} → status ${r.status}  ${JSON.stringify(r.json)}`);
    }
  }

  // Boj sabablari ro'yxati — qaysi biri bizga tegishli ekanini yurist tanlashi uchun.
  const dr = await cabinetFetch(session, '/api/cabinet/guide/duty-reasons');
  const rows: any[] = Array.isArray(dr.json) ? dr.json : (dr.json?.content ?? dr.json?.data ?? []);
  console.log(`\n=== Bojdan ozod qilish asoslari (${rows.length} ta) ===`);
  for (const r of rows) {
    console.log(`  ${r.id}  ${(r.names?.uz_cyr || r.names?.uz || r.name || '').slice(0, 95)}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
