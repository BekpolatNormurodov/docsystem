// Diagnose the «Sudga yuborish» list per firm: does ready/sendable really require boji, and do the
// «Navbatda» clients actually have boji? Also count real cabinet statuses. Read-only.
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { readScannedArizas } from '../src/lib/palata-scan';

const SENT = new Set(['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED']);

async function main() {
  const snap = await prisma.snapshot.findFirst({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' }, select: { id: true } });
  const snapshotId = snap?.id;
  const scanSet = new Set(readScannedArizas().map((r) => r.pinfl).filter(Boolean));

  const firms = await prisma.firm.findMany({ select: { id: true, code: true, shortName: true } });
  for (const f of firms) {
    const [cases, loans, cabinet] = await Promise.all([
      prisma.arizaCase.findMany({ where: { firmId: f.id, ...(snapshotId ? { snapshotId } : {}) }, select: { pinfl: true, stage: true, talabnomaAt: true, receiptNumber: true, meta: true } }),
      prisma.loan.findMany({ where: { branchCode: f.code, ...(snapshotId ? { snapshotId } : {}), summKr: { gt: 0 }, pinfl: { not: null } }, select: { pinfl: true }, distinct: ['pinfl'] }),
      prisma.clientCaseStatus.count({ where: { branchCode: f.code, source: 'CABINET' } }),
    ]);
    if (cases.length === 0) continue;
    const ofertaSet = new Set(loans.map((l) => l.pinfl));

    let ready = 0, sendable = 0, exported = 0, notready = 0, boji = 0, courtReturned = 0;
    let sendableWithBoji = 0, sendableNoBoji = 0;
    for (const c of cases) {
      const t = !!c.talabnomaAt;
      const s = !!(c.pinfl && scanSet.has(c.pinfl));
      const o = !!(c.pinfl && ofertaSet.has(c.pinfl));
      const b = !!c.receiptNumber;
      const exp = !!(c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta) && (c.meta as Record<string, unknown>).exportedAt);
      const isReady = t && s && o; // court gate = talabnoma + scan + oferta (boji NOT required)
      const isSendable = isReady && !exp && !SENT.has(c.stage);
      if (b) boji++;
      if (isReady) ready++; else notready++;
      if (exp) exported++;
      if (isSendable) { sendable++; if (b) sendableWithBoji++; else sendableNoBoji++; }
      if (c.stage === 'COURT_RETURNED') courtReturned++;
    }
    console.log(`\n${f.shortName} (${f.code}) — jami ${cases.length}`);
    console.log(`  ready(4/4)=${ready}  sendable=${sendable}  exported=${exported}  notready=${notready}`);
    console.log(`  boji bor=${boji}  |  sendable-ichida: boji bor=${sendableWithBoji} boji YO'Q=${sendableNoBoji}`);
    console.log(`  stage COURT_RETURNED=${courtReturned}  |  cabinet(CABINET) status satrlari=${cabinet}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
