// Boshliq (director) hisoboti — firma × bosqich matritsasi uchun agregatsiya.
// 4 bosqich: (1) Talabnoma, (2) Sanoat palatasi (SIGN), (3) Sudga chiqarilgan (ADOLAT statuslari
// bilan: ko'rib chiqishda / qanoatlantirilgan / qaytarilgan / rad qilingan), (4) MIBga (EXEC).
// Manba: konveyerSummary (pipeline bosqichlari + talabnoma) + courtStatusBoard (CABINET sud statuslari).
// Hech qanday yangi mantiq ixtiro qilinmaydi — mavjud, tekshirilgan funksiyalar qayta ishlatiladi.
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { konveyerSummary, phaseTotals } from '@/lib/konveyer';
import { courtStatusBoard, classifyStatus } from '@/lib/court-ready';
import { regionFromText } from '@/lib/mib/breakdown';

export interface BossSud { inReview: number; granted: number; returned: number; rejected: number; total: number }
export interface BossFirmRow {
  firmId: number;
  firmName: string;
  clients: number; // alohida qarzdorlar (PINFL) soni — «userlar»
  talabnoma: number;
  sanoat: number;
  sud: BossSud;
  mib: number;
  debt: number;
  total: number;
}
export type BossTotals = Omit<BossFirmRow, 'firmId' | 'firmName'>;
// Viloyat (14 ta) kesimi — mijozlar + MIBga + Sud (qanoatlantirilgan/qaytarilgan) + jami qarz.
// Manba: portfel Excel (Loan.regionName), tuman→viloyatga yig'iladi (regionFromText). Rus/kirill/lotin.
export interface BossRegionRow { region: string; clients: number; mib: number; sudTotal: number; granted: number; returned: number; debt: number }
export interface BossReportData { snapshotId: number | null; firms: BossFirmRow[]; totals: BossTotals; regions: BossRegionRow[] }

// courtStatusBoard bucket kodini direktor guruhiga solamiz.
// Foydalanuvchi qoidasi (2026-09-14): «rad qilingan» deb kelsa HAM, ajrim varaqasi bilan
// tasdiqlanmagan bo'lsa QAYTARILGAN sanaladi (qaytarish sud tizimida ichkariga bormasdan,
// hatto 2-3 kunda ham qaytadi). Ajrim faqat har bir ish uchun cabinet'dan LIVE olinadi — umumiy
// hisobda yo'q, shuning uchun aggregatda REFUSED (rad etilgan) va UNCONSIDERED (ko'rilmasdan) ham
// «Qaytarilgan»ga qo'shiladi. «Rad qilingan» ustuni faqat mijoz sahifasida (LIVE ajrim) to'ladi.
function sudBucketOf(code: string): keyof Omit<BossSud, 'total'> {
  if (code === 'SATISFIED' || code === 'PARTIAL' || code === 'FINISHED') return 'granted';
  if (code === 'RETURNED' || code === 'DECLINED' || code === 'UNCONSIDERED' || code === 'WITHDRAWN') return 'returned';
  return 'inReview'; // CREATED / PENDING / IN_PROCESS / DECIDED / DRAFT / boshqa jarayon
}

const emptySud = (): BossSud => ({ inReview: 0, granted: 0, returned: 0, rejected: 0, total: 0 });

// «Sudga chiqarilgan» — HALI YUBORILMAGAN ishlar hisobga OLINMAYDI (aniq son uchun). DRAFT/CREATED =
// ADOLAT'da tayyorlangan qoralama, rasmiy da'vo EMAS (court-submit-job.ts + adolat-status-suit izohi:
// CREATED=yuborilmagan). Ular sud ustunini shishirmasin.
const PRECOURT_CODES = new Set(['DRAFT', 'CREATED']);

export async function bossReport(snapshotId?: number): Promise<BossReportData> {
  const summary = await konveyerSummary(snapshotId);
  const scope = snapshotId ? { snapshotId } : {};
  const snapCond = snapshotId ? Prisma.sql`AND snapshotId = ${snapshotId}` : Prisma.empty;

  // Firma bo'yicha jami qarz (summalar) — bitta groupBy.
  const debtRows = await prisma.arizaCase.groupBy({ by: ['firmId'], where: scope, _sum: { totalDebt: true } });
  const debtByFirm = new Map<number, number>();
  for (const d of debtRows) debtByFirm.set(d.firmId, Number(d._sum.totalDebt ?? 0));

  // Alohida qarzdorlar (PINFL) soni — firma bo'yicha + umumiy («userlar soni»). Bir odam ikki
  // firmada bo'lsa: firma kesimida ikkalasida ham, UMUMIYda BIR marta sanaladi (COUNT DISTINCT).
  const clientRows = await prisma.$queryRaw<{ firmId: number; n: bigint }[]>`
    SELECT firmId, COUNT(DISTINCT pinfl) AS n FROM ArizaCase
    WHERE pinfl IS NOT NULL ${snapCond} GROUP BY firmId`;
  const clientsByFirm = new Map<number, number>();
  for (const r of clientRows) clientsByFirm.set(Number(r.firmId), Number(r.n));
  const totalClientsRows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT pinfl) AS n FROM ArizaCase WHERE pinfl IS NOT NULL ${snapCond}`;
  const totalClients = Number(totalClientsRows[0]?.n ?? 0);

  const firms: BossFirmRow[] = await Promise.all(summary.firms.map(async (f) => {
    // MUHIM: sud (CABINET) statuslari snapshot bo'yicha FILTRLANMAYDI. Sabab: status-ingest BARCHA
    // cabinet yozuvlarini FAQAT eng oxirgi snapshotId bilan belgilaydi (court-returns.ts izohi), shuning
    // uchun eski snapshot tanlansa courtStatusBoard(snapshotId) 0 qaytarardi — «Qanoatlantirilgan» va
    // butun sud ustuni yo'qolardi. Firma (branchCode) bo'yicha filtr yetarli; sud = ADOLAT hozirgi holati.
    const board = await courtStatusBoard(undefined, f.firmId);
    const sud = emptySud();
    for (const b of board.buckets) {
      if (b.source !== 'CABINET') continue; // faqat sud (ADOLAT) statuslari
      if (PRECOURT_CODES.has(b.code)) continue; // qoralama/CREATED — sudga chiqarilgan emas
      sud[sudBucketOf(b.code)] += b.count;
      sud.total += b.count;
    }
    const ph = phaseTotals(f.byStage);
    return {
      firmId: f.firmId,
      firmName: f.firmName,
      clients: clientsByFirm.get(f.firmId) ?? 0,
      talabnoma: f.talabnomaSent,
      sanoat: ph.SIGN ?? 0,
      sud,
      mib: ph.EXEC ?? 0,
      debt: debtByFirm.get(f.firmId) ?? 0,
      total: f.total,
    };
  }));

  const totals: BossTotals = firms.reduce<BossTotals>((a, r) => ({
    clients: a.clients + r.clients,
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
  }), { clients: 0, talabnoma: 0, sanoat: 0, sud: emptySud(), mib: 0, debt: 0, total: 0 });
  // Umumiy «userlar» — firma yig'indisi EMAS (bir odam bir necha firmada): butun DISTINCT PINFL.
  totals.clients = totalClients;

  const regions = await regionBreakdown(snapshotId);

  return { snapshotId: snapshotId ?? null, firms, totals, regions };
}

// ── Viloyat kesimi (mijozlar + MIBga + Sud + qarz) ────────────────────────────
// Region portfel Excel'idan (Loan.regionName). ANIQ son uchun har PINFL uchun BITTA region olinadi
// (rgn CTE: MAX(regionName) GROUP BY pinfl) — aks holda bir mijozda bir necha loan bo'lsa ArizaCase
// JOIN Loan ishni/summani KO'PAYTIRARDI. rgn bir pinfl = bir qator, shuning uchun COUNT(*)/SUM aniq.
//   • Mijozlar = COUNT(DISTINCT pinfl) shu regionda ishi borlar.
//   • MIBga    = ArizaCase EXEC (MIB_SUBMITTED/CLOSED) soni.
//   • Jami qarz= SUM(ArizaCase.totalDebt) — firma «Jami qarz»i bilan bir manba (aniq mos keladi).
//   • Sud      = ClientCaseStatus (CABINET), snapshotSIZ (cabinet oxirgi holat); DRAFT/CREATED chiqarilmaydi.
async function regionBreakdown(snapshotId?: number): Promise<BossRegionRow[]> {
  const regionSnapId = snapshotId
    ?? (await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } }))?.id
    ?? 0;
  if (!regionSnapId) return [];
  // Har PINFL → bitta region (ko'paytirishning oldini oladi). Barcha so'rovlar shu CTE'dan foydalanadi.
  const rgn = Prisma.sql`rgn AS (SELECT pinfl, MAX(regionName) AS rn FROM Loan WHERE snapshotId = ${regionSnapId} AND pinfl IS NOT NULL GROUP BY pinfl)`;

  const [baseRows, sudRows] = await Promise.all([
    // Mijozlar + MIBga + jami qarz — bitta o'tishda (ArizaCase → rgn, pinfl bo'yicha).
    prisma.$queryRaw<{ rn: string | null; clients: bigint; mib: bigint; debt: unknown }[]>`
      WITH ${rgn}
      SELECT rgn.rn AS rn,
             COUNT(DISTINCT a.pinfl) AS clients,
             COALESCE(SUM(CASE WHEN a.stage IN ('MIB_SUBMITTED','CLOSED') THEN 1 ELSE 0 END), 0) AS mib,
             COALESCE(SUM(a.totalDebt), 0) AS debt
      FROM ArizaCase a JOIN rgn ON rgn.pinfl = a.pinfl
      WHERE a.snapshotId = ${regionSnapId}
      GROUP BY rgn.rn`,
    // Sud statuslari — cabinet (snapshotsiz). DISTINCT c.id shart emas: rgn bir pinfl = bir qator.
    prisma.$queryRaw<{ rn: string | null; st: string; sl: string | null; cr: string | null; n: bigint }[]>`
      WITH ${rgn}
      SELECT rgn.rn AS rn, c.status AS st, c.statusLabel AS sl, c.caseResult AS cr, COUNT(*) AS n
      FROM ClientCaseStatus c JOIN rgn ON rgn.pinfl = c.pinfl
      WHERE c.source = 'CABINET'
      GROUP BY rgn.rn, c.status, c.statusLabel, c.caseResult`,
  ]);

  const map = new Map<string, BossRegionRow>();
  const canon = (rn: string | null) => regionFromText(rn ?? '') ?? 'Aniqlanmagan';
  const row = (name: string) => {
    let r = map.get(name);
    if (!r) { r = { region: name, clients: 0, mib: 0, sudTotal: 0, granted: 0, returned: 0, debt: 0 }; map.set(name, r); }
    return r;
  };
  for (const b of baseRows) {
    const r = row(canon(b.rn));
    r.clients += Number(b.clients);
    r.mib += Number(b.mib);
    r.debt += Number(b.debt);
  }
  for (const s of sudRows) {
    const code = classifyStatus('CABINET', { status: s.st, statusLabel: s.sl, caseResult: s.cr }).code;
    if (PRECOURT_CODES.has(code)) continue; // qoralama/CREATED — sudga chiqarilgan emas
    const r = row(canon(s.rn));
    const cnt = Number(s.n);
    r.sudTotal += cnt;
    const bucket = sudBucketOf(code);
    if (bucket === 'granted') r.granted += cnt;
    else if (bucket === 'returned') r.returned += cnt;
  }
  // Aniqlanmagan har doim oxirida; qolganlari hajm bo'yicha (qarz + ish).
  return [...map.values()].sort((a, b) => {
    if ((a.region === 'Aniqlanmagan') !== (b.region === 'Aniqlanmagan')) return a.region === 'Aniqlanmagan' ? 1 : -1;
    return (b.mib + b.sudTotal) - (a.mib + a.sudTotal) || b.debt - a.debt || a.region.localeCompare(b.region);
  });
}
