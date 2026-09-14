// Boshliq (director) hisoboti — firma × bosqich matritsasi uchun agregatsiya.
// 4 bosqich: (1) Talabnoma, (2) Sanoat palatasi (SIGN), (3) Sudga chiqarilgan (ADOLAT statuslari
// bilan: ko'rib chiqishda / qanoatlantirilgan / qaytarilgan / rad qilingan), (4) MIBga (EXEC).
// Manba: konveyerSummary (pipeline bosqichlari + talabnoma) + courtStatusBoard (CABINET sud statuslari).
// Hech qanday yangi mantiq ixtiro qilinmaydi — mavjud, tekshirilgan funksiyalar qayta ishlatiladi.
import { prisma } from '@/lib/db';
import { konveyerSummary, phaseTotals } from '@/lib/konveyer';
import { courtStatusBoard } from '@/lib/court-ready';

export interface BossSud { inReview: number; granted: number; returned: number; rejected: number; total: number }
export interface BossFirmRow {
  firmId: number;
  firmName: string;
  talabnoma: number;
  sanoat: number;
  sud: BossSud;
  mib: number;
  debt: number;
  total: number;
}
export type BossTotals = Omit<BossFirmRow, 'firmId' | 'firmName'>;
export interface BossReportData { snapshotId: number | null; firms: BossFirmRow[]; totals: BossTotals }

// courtStatusBoard bucket kodini 4 direktor guruhiga solamiz.
function sudBucketOf(code: string): keyof Omit<BossSud, 'total'> {
  if (code === 'SATISFIED' || code === 'PARTIAL' || code === 'FINISHED') return 'granted';
  if (code === 'RETURNED') return 'returned';
  if (code === 'DECLINED' || code === 'UNCONSIDERED') return 'rejected';
  return 'inReview'; // CREATED / PENDING / IN_PROCESS / DECIDED / DRAFT / boshqa jarayon
}

const emptySud = (): BossSud => ({ inReview: 0, granted: 0, returned: 0, rejected: 0, total: 0 });

export async function bossReport(snapshotId?: number): Promise<BossReportData> {
  const summary = await konveyerSummary(snapshotId);
  const scope = snapshotId ? { snapshotId } : {};

  // Firma bo'yicha jami qarz (summalar) — bitta groupBy.
  const debtRows = await prisma.arizaCase.groupBy({ by: ['firmId'], where: scope, _sum: { totalDebt: true } });
  const debtByFirm = new Map<number, number>();
  for (const d of debtRows) debtByFirm.set(d.firmId, Number(d._sum.totalDebt ?? 0));

  const firms: BossFirmRow[] = await Promise.all(summary.firms.map(async (f) => {
    const board = await courtStatusBoard(snapshotId, f.firmId);
    const sud = emptySud();
    for (const b of board.buckets) {
      if (b.source !== 'CABINET') continue; // faqat sud (ADOLAT) statuslari
      sud[sudBucketOf(b.code)] += b.count;
      sud.total += b.count;
    }
    const ph = phaseTotals(f.byStage);
    return {
      firmId: f.firmId,
      firmName: f.firmName,
      talabnoma: f.talabnomaSent,
      sanoat: ph.SIGN ?? 0,
      sud,
      mib: ph.EXEC ?? 0,
      debt: debtByFirm.get(f.firmId) ?? 0,
      total: f.total,
    };
  }));

  const totals: BossTotals = firms.reduce<BossTotals>((a, r) => ({
    talabnoma: a.talabnoma + r.talabnoma,
    sanoat: a.sanoat + r.sanoat,
    sud: {
      inReview: a.sud.inReview + r.sud.inReview,
      granted: a.sud.granted + r.sud.granted,
      returned: a.sud.returned + r.sud.returned,
      rejected: a.sud.rejected + r.sud.rejected,
      total: a.sud.total + r.sud.total,
    },
    mib: a.mib + r.mib,
    debt: a.debt + r.debt,
    total: a.total + r.total,
  }), { talabnoma: 0, sanoat: 0, sud: emptySud(), mib: 0, debt: 0, total: 0 });

  return { snapshotId: snapshotId ?? null, firms, totals };
}
