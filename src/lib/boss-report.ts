// Boshliq (director) hisoboti — firma × bosqich matritsasi uchun agregatsiya.
// 4 bosqich: (1) Talabnoma, (2) Sanoat palatasi (SIGN), (3) Sudga chiqarilgan (ADOLAT statuslari
// bilan: ko'rib chiqishda / qanoatlantirilgan / qaytarilgan / rad qilingan), (4) MIBga (EXEC).
// Manba: konveyerSummary (pipeline bosqichlari + talabnoma) + courtStatusBoard (CABINET sud statuslari).
// Hech qanday yangi mantiq ixtiro qilinmaydi — mavjud, tekshirilgan funksiyalar qayta ishlatiladi.
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { konveyerSummary, phaseTotals } from '@/lib/konveyer';
import { classifyStatus } from '@/lib/court-ready';
import { regionFromText } from '@/lib/mib/breakdown';
import { firmActivity } from '@/lib/active-firms';

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
export interface BossRegionRow { region: string; clients: number; talabnoma: number; mib: number; sudTotal: number; granted: number; returned: number; debt: number }
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
  // firmActivity bir marta — hamma sub-funksiya (region, sud-bulk) shuni ishlatadi.
  const fa = await firmActivity();
  const scope = { ...(snapshotId ? { snapshotId } : {}), ...fa.caseWhere };
  const snapCond = snapshotId ? Prisma.sql`AND snapshotId = ${snapshotId}` : Prisma.empty;
  // Nofaol firma ishlarini grand-total (DISTINCT PINFL) va region agregatlaridan ham chiqaramiz.
  const inactiveCaseCond = fa.hasInactive ? Prisma.sql`AND firmId NOT IN (${Prisma.join(fa.inactiveIds)})` : Prisma.empty;

  // 3 ta og'ir so'rov parallel: konveyer summary, firma-jami qarzi, region kesimi. Ilgari
  // ular ketma-ket bajarilardi — endi bir vaqtda (~30-40% tez).
  const [summary, debtRows, regions] = await Promise.all([
    konveyerSummary(snapshotId),
    prisma.arizaCase.groupBy({ by: ['firmId'], where: scope, _sum: { totalDebt: true } }),
    regionBreakdown(snapshotId, fa),
  ]);
  const debtByFirm = new Map<number, number>();
  for (const d of debtRows) debtByFirm.set(d.firmId, Number(d._sum.totalDebt ?? 0));

  // Alohida qarzdorlar (PINFL) soni — firma bo'yicha + umumiy («userlar soni»). Bir odam ikki
  // firmada bo'lsa: firma kesimida ikkalasida ham, UMUMIYda BIR marta sanaladi (COUNT DISTINCT).
  // Bitta SQL: firma bo'yicha + jami (WITH ROLLUP) — ikki round-trip o'rniga bittasi.
  const clientRows = await prisma.$queryRaw<{ firmId: number | null; n: bigint }[]>`
    SELECT firmId, COUNT(DISTINCT pinfl) AS n FROM ArizaCase
    WHERE pinfl IS NOT NULL ${snapCond} ${inactiveCaseCond}
    GROUP BY firmId WITH ROLLUP`;
  const clientsByFirm = new Map<number, number>();
  let totalClients = 0;
  for (const r of clientRows) {
    if (r.firmId == null) totalClients = Number(r.n);
    else clientsByFirm.set(Number(r.firmId), Number(r.n));
  }

  // SUD (CABINET) statuslarini BITTA groupBy'da barcha firmalar uchun olamiz (ilgari N firma × 2
  // so'rov = 8-10 round-trip; endi bittasi). branchCode → firmId JS'da bog'lanadi.
  // MUHIM: snapshotSIZ — status-ingest cabinet yozuvlarini FAQAT eng oxirgi snapshotId bilan
  // belgilaydi (court-returns.ts izohi + memory: cabinet-status-snapshot-and-result). Firma
  // (branchCode) filtri yetarli; sud = ADOLAT hozirgi holati.
  const firmMeta = await prisma.firm.findMany({ select: { id: true, code: true } });
  const firmIdByCode = new Map(firmMeta.filter((f) => f.code).map((f) => [f.code!, f.id]));
  const inactiveCodeSet = new Set(fa.inactiveCodes);
  const sudGrouped = await prisma.clientCaseStatus.groupBy({
    by: ['branchCode', 'status', 'statusLabel', 'caseResult', 'source'],
    where: { source: 'CABINET' },
    _count: { _all: true },
  });
  const sudByFirm = new Map<number, BossSud>();
  for (const g of sudGrouped) {
    if (!g.branchCode || inactiveCodeSet.has(g.branchCode)) continue;
    const fid = firmIdByCode.get(g.branchCode);
    if (!fid) continue;
    const code = classifyStatus('CABINET', { status: g.status, statusLabel: g.statusLabel, caseResult: g.caseResult }).code;
    if (PRECOURT_CODES.has(code)) continue; // qoralama/CREATED — sudga chiqarilgan emas
    let sud = sudByFirm.get(fid);
    if (!sud) { sud = emptySud(); sudByFirm.set(fid, sud); }
    sud[sudBucketOf(code)] += g._count._all;
    sud.total += g._count._all;
  }

  const firms: BossFirmRow[] = summary.firms.map((f) => {
    const ph = phaseTotals(f.byStage);
    return {
      firmId: f.firmId,
      firmName: f.firmName,
      clients: clientsByFirm.get(f.firmId) ?? 0,
      talabnoma: f.talabnomaSent,
      // «Sanoat palatasi» = IMZOLANGAN skan biriktirilganlar (SIGNED_SCANNED) — sudga ketadigan
      // asosiy pool. Butun SIGN fazasi (ariza/chop/palataga yuborilgan…) emas, faqat skanerlangan.
      sanoat: f.byStage['SIGNED_SCANNED'] ?? 0,
      sud: sudByFirm.get(f.firmId) ?? emptySud(),
      mib: ph.EXEC ?? 0,
      debt: debtByFirm.get(f.firmId) ?? 0,
      total: f.total,
    };
  });

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
async function regionBreakdown(snapshotId: number | undefined, fa: Awaited<ReturnType<typeof firmActivity>>): Promise<BossRegionRow[]> {
  const regionSnapId = snapshotId
    ?? (await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } }))?.id
    ?? 0;
  if (!regionSnapId) return [];
  const canon = (rn: string | null) => regionFromText(rn ?? '') ?? 'Aniqlanmagan';
  // TEZLIK: to'liq Loan'ni skanerlab region olish (regionName indekssiz) ~22s edi va Boshliq sahifasi
  // qotib qolardi (snapshot almashtirib bo'lmasdi). Endi region FAQAT kerakli pinfl'lar uchun,
  // pinfl-indeks bilan (FORCE INDEX Loan_pinfl_snapshotId_idx) olinadi (~2s). ArizaCase/ClientCaseStatus
  // kichik va indeksli — yig'ish JS'da. acRows/ccsRows parallel; region so'rovi ular topgan PINFL'lar bo'yicha.
  const [acRows, ccsRows] = await Promise.all([
    prisma.arizaCase.findMany({ where: { snapshotId: regionSnapId, pinfl: { not: null }, ...fa.caseWhere }, select: { pinfl: true, stage: true, totalDebt: true, talabnomaAt: true } }),
    prisma.clientCaseStatus.findMany({ where: { source: 'CABINET', pinfl: { not: null }, ...(fa.hasInactive ? { branchCode: { notIn: fa.inactiveCodes } } : {}) }, select: { pinfl: true, status: true, statusLabel: true, caseResult: true } }),
  ]);
  // Region FAQAT kerakli PINFL'lar uchun. ILGARI: `l.pinfl IN (SELECT … UNION SELECT …)` subquery +
  // FORCE INDEX — MySQL buni DEPENDENT subquery qilib ~159k Loan qatoriga qayta bajarardi → ~46s va
  // Boshliq sahifasi (sana almashtirilganda) qotib qolardi. Endi kerakli PINFL'larni JS'da (allaqachon
  // o'qilgan acRows+ccsRows'dan) yig'ib, LITERAL IN-ro'yxat bilan bitta indeksli GROUP BY qilamiz (~2.5s).
  const pinflSet = new Set<string>();
  for (const a of acRows) if (a.pinfl) pinflSet.add(a.pinfl);
  for (const c of ccsRows) if (c.pinfl) pinflSet.add(c.pinfl);
  const pinfls = [...pinflSet];
  const locRows = pinfls.length
    ? await prisma.$queryRaw<{ pinfl: string; rn: string | null }[]>`
        SELECT l.pinfl AS pinfl, MAX(l.regionName) AS rn
        FROM Loan l
        WHERE l.snapshotId = ${regionSnapId} AND l.pinfl IN (${Prisma.join(pinfls)})
        GROUP BY l.pinfl`
    : [];
  const regByPinfl = new Map<string, string>();
  for (const r of locRows) regByPinfl.set(r.pinfl, canon(r.rn));
  const regOf = (p: string | null) => (p ? regByPinfl.get(p) : undefined) ?? 'Aniqlanmagan';

  const map = new Map<string, BossRegionRow>();
  const row = (name: string) => {
    let r = map.get(name);
    if (!r) { r = { region: name, clients: 0, talabnoma: 0, mib: 0, sudTotal: 0, granted: 0, returned: 0, debt: 0 }; map.set(name, r); }
    return r;
  };
  // MIBga + jami qarz + mijozlar (region bo'yicha alohida PINFL) — ArizaCase'dan.
  // Talabnoma = shu regionda talabnomasi ketgan alohida PINFL (kishi bo'yicha, ish bo'yicha emas).
  const EXEC = new Set(['MIB_SUBMITTED', 'CLOSED']);
  const seen = new Map<string, Set<string>>();
  const talSeen = new Map<string, Set<string>>();
  for (const a of acRows) {
    const reg = regOf(a.pinfl);
    const r = row(reg);
    r.debt += Number(a.totalDebt ?? 0);
    if (EXEC.has(a.stage)) r.mib += 1;
    let s = seen.get(reg); if (!s) { s = new Set(); seen.set(reg, s); } if (a.pinfl) s.add(a.pinfl);
    if (a.talabnomaAt && a.pinfl) { let ts = talSeen.get(reg); if (!ts) { ts = new Set(); talSeen.set(reg, ts); } ts.add(a.pinfl); }
  }
  for (const [reg, s] of seen) row(reg).clients = s.size;
  for (const [reg, ts] of talSeen) row(reg).talabnoma = ts.size;
  // Sud (CABINET) — DRAFT/CREATED chiqarilmaydi; rad→qaytarilgan qoidasi sudBucketOf'da.
  for (const c of ccsRows) {
    const code = classifyStatus('CABINET', { status: c.status, statusLabel: c.statusLabel, caseResult: c.caseResult }).code;
    if (PRECOURT_CODES.has(code)) continue;
    const r = row(regOf(c.pinfl));
    r.sudTotal += 1;
    const bucket = sudBucketOf(code);
    if (bucket === 'granted') r.granted += 1;
    else if (bucket === 'returned') r.returned += 1;
  }
  // Aniqlanmagan har doim oxirida; qolganlari hajm bo'yicha (qarz + ish).
  return [...map.values()].sort((a, b) => {
    if ((a.region === 'Aniqlanmagan') !== (b.region === 'Aniqlanmagan')) return a.region === 'Aniqlanmagan' ? 1 : -1;
    return (b.mib + b.sudTotal) - (a.mib + a.sudTotal) || b.debt - a.debt || a.region.localeCompare(b.region);
  });
}
