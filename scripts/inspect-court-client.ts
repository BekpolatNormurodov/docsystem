// One-off: pick the most court-complete real client and report the readiness of ALL 7 court docs:
//  1 Ariza  2 Talabnoma  3 Talabnoma-delivered(hippo)  4 Signed scan(palata)  5 Invoice  6 Oferta(N)  7 Firm docs
// Read-only. Run: npx tsx scripts/inspect-court-client.ts [firmCode]
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { readScannedArizas } from '../src/lib/palata-scan';

const yn = (b: boolean) => (b ? 'BOR ✓' : "yo'q ✗");

async function main() {
  const argFirm = process.argv[2] || null;
  const snap = await prisma.snapshot.findFirst({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' }, select: { id: true, reportDate: true } });
  const snapshotId = snap?.id;
  console.log(`Snapshot: #${snapshotId} (${snap?.reportDate?.toISOString().slice(0, 10)})`);

  const scanRows = readScannedArizas();
  const scanSet = new Set(scanRows.map((r) => r.pinfl).filter(Boolean));
  console.log(`Palata-scan JSON: ${scanRows.length} ariza, ${scanSet.size} distinct PINFL\n`);

  const firms = await prisma.firm.findMany({ select: { id: true, code: true, shortName: true } });
  const firmById = new Map(firms.map((f) => [f.id, f]));
  const firmDocsByFirm = new Map<number, string[]>();
  for (const f of firms) {
    const fd = await prisma.firmDocument.findMany({ where: { firmId: f.id }, select: { kind: true } });
    firmDocsByFirm.set(f.id, fd.map((d) => d.kind));
  }

  // Stage distribution per firm (so we see where cases actually are).
  console.log('=== Stage distribution (firma → stage:count) ===');
  for (const f of firms) {
    const g = await prisma.arizaCase.groupBy({ by: ['stage'], where: { firmId: f.id, ...(snapshotId ? { snapshotId } : {}) }, _count: { _all: true } });
    if (g.length) console.log(`  ${f.shortName}: ` + g.map((s) => `${s.stage}:${s._count._all}`).join('  '));
  }
  console.log('');

  // Candidate pool = cases that already have BOTH an invoice (receiptNumber) AND talabnoma sent.
  const firmFilter = argFirm ? firms.find((f) => f.code === argFirm)?.id : undefined;
  const cands = await prisma.arizaCase.findMany({
    where: {
      ...(snapshotId ? { snapshotId } : {}),
      ...(firmFilter ? { firmId: firmFilter } : {}),
      receiptNumber: { not: null },
      talabnomaAt: { not: null },
    },
    select: { id: true, clientName: true, pinfl: true, firmId: true, kod: true, stage: true, receiptNumber: true, talabnomaAt: true, totalDebt: true },
    take: 500,
  });
  console.log(`Candidates (invoice + talabnoma): ${cands.length}${argFirm ? ` (firma ${argFirm})` : ''}`);

  // Score each candidate on the 7 docs.
  type Scored = { c: (typeof cands)[number]; score: number; hippo: boolean; scan: boolean; contracts: number; firmDocs: string[] };
  const scored: Scored[] = [];
  for (const c of cands) {
    if (!c.pinfl) continue;
    const [contracts, hippoMail] = await Promise.all([
      prisma.loan.count({ where: { snapshotId: snapshotId ?? undefined, pinfl: c.pinfl, ...(c.kod ? { branchCode: c.kod } : {}), summKr: { gt: 0 } } }),
      prisma.clientCaseStatus.findFirst({
        where: { source: 'HIPPO', category: 'talabnoma', pinfl: c.pinfl, ...(c.kod ? { branchCode: c.kod } : {}), caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } } },
        select: { id: true },
      }),
    ]);
    const scan = scanSet.has(c.pinfl);
    const firmDocs = firmDocsByFirm.get(c.firmId) ?? [];
    const hasFirmDocs = firmDocs.length > 0;
    const score = 1 /*ariza*/ + 1 /*talabnoma*/ + (hippoMail ? 1 : 0) + (scan ? 1 : 0) + 1 /*invoice*/ + (contracts > 0 ? 1 : 0) + (hasFirmDocs ? 1 : 0);
    scored.push({ c, score, hippo: !!hippoMail, scan, contracts, firmDocs });
  }
  scored.sort((a, b) => b.score - a.score || Number(b.c.totalDebt) - Number(a.c.totalDebt));

  console.log(`\n=== TOP 5 most-complete clients ===`);
  for (const s of scored.slice(0, 5)) {
    const f = firmById.get(s.c.firmId);
    console.log(`  [${s.score}/7] ${s.c.clientName} · ${s.c.pinfl} · ${f?.shortName} · ${s.c.stage} · oferta:${s.contracts} scan:${s.scan ? 'Y' : 'N'} hippo:${s.hippo ? 'Y' : 'N'}`);
  }

  const best = scored[0];
  if (!best) { console.log('\nNo candidate found.'); return; }
  const f = firmById.get(best.c.firmId);
  console.log(`\n================ BEST CLIENT — full 7-doc court checklist ================`);
  console.log(`  Mijoz: ${best.c.clientName}`);
  console.log(`  PINFL: ${best.c.pinfl}   Firma: ${f?.shortName} (${best.c.kod})   Bosqich: ${best.c.stage}   Qarz: ${Number(best.c.totalDebt).toLocaleString('ru-RU')}`);
  console.log(`  ------------------------------------------------------------------------`);
  console.log(`  1) Ariza (.docx)                 : ${yn(true)}  (portfeldan generatsiya)`);
  console.log(`  2) Talabnoma (PDF)               : ${yn(!!best.c.talabnomaAt)}  (yuborilgan: ${best.c.talabnomaAt?.toISOString().slice(0, 10)})`);
  console.log(`  3) Talabnoma — yetkazilgan(hippo): ${yn(best.hippo)}  ${best.hippo ? '' : '(ingest qilingan hippo xat yo‘q)'}`);
  console.log(`  4) Imzolangan skan (palatadan)   : ${yn(best.scan)}  ${best.scan ? '' : '(palata-scan.json da PINFL yo‘q)'}`);
  console.log(`  5) Invoice / kvitansiya          : ${yn(!!best.c.receiptNumber)}  (№ ${best.c.receiptNumber})`);
  console.log(`  6) Oferta (har shartnomaga)      : ${yn(best.contracts > 0)}  (${best.contracts} ta shartnoma)`);
  console.log(`  7) Firma hujjatlari              : ${yn(best.firmDocs.length > 0)}  [${best.firmDocs.join(', ') || '—'}]`);
  console.log(`  ========================================================================`);
  console.log(`  Court-gate (4 shart: talabnoma+skan+oferta+boji) = ${(!!best.c.talabnomaAt && best.scan && best.contracts > 0 && !!best.c.receiptNumber) ? 'TAYYOR ✓' : 'TAYYOR EMAS ✗'}`);
  console.log(`\n  caseId=${best.c.id}  → to render the full packet: npx tsx scripts/gen-court-packet.ts ${best.c.id}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
