// Fetch full detail + history for the DECLINED cabinet cases to find the reason.
//   npx tsx scripts/cabinet-case-detail.ts
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';
import { prisma } from '../src/lib/db';

async function main() {
  const s = await getStoredCabinetSession('311976765');
  const declined = await prisma.clientCaseStatus.findMany({
    where: { source: 'CABINET', branchCode: '12842', status: 'DECLINED' },
    select: { clientName: true, caseNumber: true, claimId: true },
  });
  for (const d of declined) {
    const id = d.claimId ?? d.caseNumber;
    const one = await cabinetFetch(s, `/api/cabinet/case/get-one-case-by-id/${id}`);
    const j: any = one.json ?? {};
    const reason = j.case_result ?? j.result ?? j.reason ?? j.decline_reason ?? j.rejectReason ?? j.status_reason;
    console.log(`\n${d.clientName}  (${one.status})`);
    console.log('  keys:', Object.keys(j).join(', ').slice(0, 200));
    console.log('  result/reason:', JSON.stringify(reason) ?? '—');
    // history often holds the decline note
    const hist = await cabinetFetch(s, `/api/cabinet/case/conflict-suit-view/histories/${id}`);
    const h = Array.isArray(hist.json) ? hist.json : hist.json?.content ?? hist.json?.data ?? [];
    if (Array.isArray(h) && h.length) console.log('  history:', JSON.stringify(h).slice(0, 300));
    break; // just the first, to inspect shape
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
