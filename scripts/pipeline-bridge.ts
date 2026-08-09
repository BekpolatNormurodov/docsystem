// Bridge real court/letter statuses (clientcasestatus) INTO the konveyer pipeline
// (arizacase) so the dashboard shows true progress. Advance-only (never regresses
// a stage), sets courtCaseId, and records the granular real court status in
// arizacase.meta.courtStatus (JSON merge — does not clobber other meta). Runs for
// ALL firms present in arizacase; only rows with real data advance.
//   npx tsx scripts/pipeline-bridge.ts [--dry]
import { prisma } from '../src/lib/db';

const STAGES = ['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];
const idx = (s: string) => STAGES.indexOf(s);

// case_result -> Uzbek UI label (from cabinet i18n).
export const RESULT_UZ: Record<string, string> = {
  FULFILLED: 'Qanoatlantirilgan (MIB oldi)',
  PARTIALLY_FULFILLED: 'Qisman qanoatlantirilgan (MIB oldi)',
  RETURNED: 'Qaytarilgan',
  REFUSED: 'Qanoatlantirilmagan',
  UNCONSIDERED: 'Ko`rmasdan qoldirilgan',
  STOPPED: 'Tugatilgan',
};

// cabinet (status, case_result) -> pipeline stage. FULFILLED/PARTIALLY_FULFILLED
// = sud qanoatlantirdi -> ijroga (MIB) o'tdi -> MIB_SUBMITTED. RETURNED/REFUSED/
// UNCONSIDERED/STOPPED = qaytdi/rad -> COURT_RETURNED (needs refiling).
function cabinetStage(status: string, result: string | null): string | null {
  if (result === 'FULFILLED' || result === 'PARTIALLY_FULFILLED') return 'MIB_SUBMITTED';
  if (result === 'RETURNED' || result === 'REFUSED' || result === 'UNCONSIDERED' || result === 'STOPPED') return 'COURT_RETURNED';
  switch (status) {
    case 'CREATED': case 'PENDING': return 'COURT_SUBMITTED';
    case 'IN_PROCESS': return 'COURT_ACCEPTED';
    case 'DECIDED': case 'FINISHED': return 'COURT_ACCEPTED';
    case 'DECLINED': return 'COURT_RETURNED';
    default: return null;
  }
}
const DELIVERED = new Set(['SuccessDelivered', 'Success']);

async function main() {
  const dry = process.argv.includes('--dry');

  // 1. index real statuses by branchCode|pinfl
  const ccs = await prisma.clientCaseStatus.findMany({
    where: { pinfl: { not: null } },
    select: { branchCode: true, pinfl: true, source: true, status: true, caseResult: true, caseNumber: true },
  });
  interface Agg { bestStage: number; courtCaseId: string | null; courtStatus: string | null; courtResult: string | null; talabnoma: boolean }
  const map = new Map<string, Agg>();
  for (const r of ccs) {
    const key = `${r.branchCode}|${r.pinfl}`;
    const a = map.get(key) ?? { bestStage: -1, courtCaseId: null, courtStatus: null, courtResult: null, talabnoma: false };
    if (r.source === 'CABINET') {
      const st = cabinetStage(r.status, r.caseResult);
      if (st && idx(st) > a.bestStage) { a.bestStage = idx(st); a.courtCaseId = r.caseNumber; a.courtStatus = r.status; a.courtResult = r.caseResult; }
    } else if (r.source === 'HIPPO' && DELIVERED.has(r.status)) {
      a.talabnoma = true;
    }
    map.set(key, a);
  }
  console.log(`real-status clients: ${map.size}`);

  // 2. read pipeline rows
  const rows: any[] = await prisma.$queryRawUnsafe('SELECT id, pinfl, kod, stage FROM arizacase');
  let advanced = 0, courtSet = 0, talabnomaSet = 0;
  const perFirm = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.kod}|${row.pinfl}`;
    const a = map.get(key);
    if (!a) continue;
    // target = furthest of (court stage) / (talabnoma) vs current
    let target = idx(row.stage);
    if (a.bestStage >= 0 && a.bestStage > target) target = a.bestStage;
    if (a.talabnoma && idx('TALABNOMA_SENT') > target) target = idx('TALABNOMA_SENT');
    const newStage = STAGES[target];
    const changed = newStage !== row.stage || a.courtCaseId;
    if (!changed) continue;

    if (!dry) {
      await prisma.$executeRawUnsafe(
        `UPDATE arizacase SET stage=?, stageEnteredAt=IF(stage<>?, NOW(3), stageEnteredAt),
           courtCaseId=COALESCE(?, courtCaseId),
           meta=JSON_MERGE_PATCH(COALESCE(meta,'{}'), CAST(? AS JSON))
         WHERE id=?`,
        newStage, newStage, a.courtCaseId,
        JSON.stringify({ courtStatus: a.courtStatus, courtResult: a.courtResult, courtResultLabel: a.courtResult ? RESULT_UZ[a.courtResult] ?? a.courtResult : null, talabnoma: a.talabnoma, bridgedAt: new Date().toISOString() }),
        row.id,
      );
    }
    if (newStage !== row.stage) { advanced++; perFirm.set(row.kod, (perFirm.get(row.kod) ?? 0) + 1); }
    if (a.courtCaseId) courtSet++;
    if (a.talabnoma) talabnomaSet++;
  }

  console.log(`\n${dry ? '[DRY] ' : ''}pipeline rows: ${rows.length}`);
  console.log(`  advanced stage: ${advanced}`);
  console.log(`  courtCaseId set: ${courtSet}`);
  console.log(`  talabnoma-linked: ${talabnomaSet}`);
  console.log('  by firm (advanced):', [...perFirm.entries()].map(([k, v]) => `${k}=${v}`).join('  '));
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
