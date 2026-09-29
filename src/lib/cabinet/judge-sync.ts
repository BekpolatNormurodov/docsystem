// SUDYA SINXRONI — «oxirigacha». Sudga tushgan (raqamli) har bir cabinet ishi uchun detal qayta
// so'raladi va sudya (chairman) yoziladi. Hisobot «Sudya boʻyicha» bo'limi va MIB hisoboti (har ijro
// ishining sudyasi) shu ma'lumotga tayanadi.
//
// NEGA ESKI SINXRON YETMADI (2026-09-28): u «detali bor» ishni hal qilingan deb o'tkazib yuborardi.
// Detal esa ko'pincha sudya TAYINLANMASDAN oldin (CREATED/REGISTER paytida) olingan — keyin hech
// qachon yangilanmagan. Natija: DECIDED/FINISHED ishlarning minglabida sudya bo'sh edi. Bundan
// tashqari «kuchaytirilgan sinxron» bir bosishda firmaga atigi 200 ta olardi va web jarayonida
// yurardi (deploy uni o'ldirardi, qulf 30 daqiqada «eskirib» ikkinchi nusxa ochilardi).
//
// Endi: worker'da, bitta ketma-ketlikda (cabinet'ni bloklamaslik uchun 8 s pauza), ro'yxat TUGAGUNCHA.
// Har tekshirilgan ish detaliga `_checkedAt` qo'yiladi — N kun ichida qayta so'ralmaydi, shuning
// uchun jarayon albatta oxiriga yetadi va worker restart bo'lsa ham qolgan joyidan davom etadi.
import { prisma } from '../db';
import { cabinetFetch } from './api';
import type { CabinetSession } from './oneid';
import { applyCaseDetail, listCabinetCaseIds, DETAIL_FETCH_INTERVAL_MS } from './detail-ingest';

export const JUDGE_SYNC_REQUEST = 'judge_sync_request'; // JSON {at, mibReportId?, retryAt?}
export const JUDGE_SYNC_STATE = 'judge_sync_state';     // JSON JudgeSyncState
export const JUDGE_SYNC_STOP = 'judge_sync_stop';       // '1' — keyingi ish oldidan to'xtaydi
/** Sudyasi topilmagan ish shuncha kundan keyin qayta so'raladi (sudya keyin tayinlanishi mumkin). */
export const JUDGE_RECHECK_DAYS = 3;
/** Heartbeat shundan eski bo'lsa — jarayon o'lgan (worker restart), «ishlayapti» deb ko'rsatilmaydi. */
export const JUDGE_HEARTBEAT_STALE_MS = 5 * 60_000;

export interface JudgeSyncState {
  running: boolean;
  startedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
  total: number;      // shu yurishda tekshiriladigan ishlar
  done: number;       // tekshirildi
  found: number;      // sudya topildi
  failed: number;     // so'rov xatosi (keyinroq qayta urinadi)
  firm: string | null;
  mibReportId: number | null;
  stopped: boolean;
  note: string | null;
}
export const EMPTY_JUDGE_STATE: JudgeSyncState = {
  running: false, startedAt: null, heartbeatAt: null, finishedAt: null, total: 0, done: 0, found: 0, failed: 0,
  firm: null, mibReportId: null, stopped: false, note: null,
};

/** Sud hujjat raqamidan sud ish raqami: «2-1004-2606/36069-2-8916» → «2-1004-2606/36069». */
export function courtCaseBase(docNumber: string | null | undefined): string | null {
  const m = (docNumber ?? '').trim().match(/^(\d+-\d+-\d+\/\d+)/);
  return m ? m[1]! : null;
}

export async function readJudgeState(): Promise<JudgeSyncState> {
  const s = await prisma.setting.findUnique({ where: { key: JUDGE_SYNC_STATE }, select: { value: true } });
  try { return { ...EMPTY_JUDGE_STATE, ...(s?.value ? JSON.parse(s.value) : {}) }; } catch { return { ...EMPTY_JUDGE_STATE }; }
}
export async function writeJudgeState(st: JudgeSyncState): Promise<void> {
  const value = JSON.stringify(st);
  await prisma.setting.upsert({ where: { key: JUDGE_SYNC_STATE }, create: { key: JUDGE_SYNC_STATE, value }, update: { value } });
}
/** Jonli ishlayaptimi (heartbeat yangi)? */
export const judgeStateAlive = (st: JudgeSyncState) =>
  st.running && !!st.heartbeatAt && Date.now() - new Date(st.heartbeatAt).getTime() < JUDGE_HEARTBEAT_STALE_MS;

/** Keyingi rejali (avtomatik) tekshiruv oralig'i — yangi sud ishlarining sudyalari doim to'lib tursin. */
export const JUDGE_SCHEDULE_MS = 6 * 3_600_000;

/**
 * Worker'ga sinxron so'rovi. mibReportId berilsa — o'sha MIB hisobotining ishlari BIRINCHI.
 * retryAt — shu vaqtdan oldin boshlanmaydi; reason: 'retry' (cabinet javob bermadi) | 'schedule' (rejali).
 */
export async function requestJudgeSync(
  mibReportId: number | null = null, retryAt: Date | null = null, reason: 'retry' | 'schedule' | null = null,
): Promise<void> {
  const value = JSON.stringify({ at: new Date().toISOString(), mibReportId, retryAt: retryAt?.toISOString() ?? null, reason });
  await prisma.setting.upsert({ where: { key: JUDGE_SYNC_REQUEST }, create: { key: JUDGE_SYNC_REQUEST, value }, update: { value } });
  await prisma.setting.deleteMany({ where: { key: JUDGE_SYNC_STOP } });
}

interface PendingRow { id: number; branchCode: string; caseNumber: string; status: string; realId: string | null }

/**
 * Sudyasi yo'q, sudga tushgan (raqami «2-1004-…/…» ko'rinishida) va yaqinda tekshirilmagan ishlar.
 * CREATED/DRAFT — hali sudga tushmagan, sudya bo'lmaydi.
 */
export async function judgePending(): Promise<PendingRow[]> {
  const since = new Date(Date.now() - JUDGE_RECHECK_DAYS * 86_400_000).toISOString();
  return prisma.$queryRaw<PendingRow[]>`
    SELECT id, branchCode, caseNumber, status,
      JSON_UNQUOTE(JSON_EXTRACT(detail, '$.participants[0].participant.case_id')) AS realId
    FROM ClientCaseStatus
    WHERE source = 'CABINET' AND (judge IS NULL OR judge = '')
      AND status NOT IN ('DRAFT', 'CREATED')
      AND caseNumber REGEXP '^[0-9]+-[0-9]+-[0-9]+/[0-9]+$'
      AND (detail IS NULL
        OR JSON_EXTRACT(detail, '$._checkedAt') IS NULL
        OR JSON_UNQUOTE(JSON_EXTRACT(detail, '$._checkedAt')) < ${since})`;
}

/** MIB ijro ishlariga bog'langan sud ish raqamlari (ustuvor). mibReportId — faqat o'sha hisobot. */
export async function mibCourtBases(mibReportId: number | null): Promise<Set<string>> {
  const rows = await prisma.mibCase.findMany({
    where: {
      isTargetFirm: true, archivedAt: null, courtDocNumber: { not: null },
      ...(mibReportId ? { client: { reportId: mibReportId } } : {}),
    },
    select: { courtDocNumber: true },
  });
  const out = new Set<string>();
  for (const r of rows) { const b = courtCaseBase(r.courtDocNumber); if (b) out.add(b); }
  return out;
}

/** Topilmagan / detal bermagan ishni ham «tekshirildi» deb belgilaymiz — ro'yxat oxiriga yetsin. */
async function stampChecked(id: number): Promise<void> {
  const now = new Date().toISOString();
  await prisma.$executeRaw`
    UPDATE ClientCaseStatus SET detail = JSON_SET(COALESCE(detail, JSON_OBJECT()), '$._checkedAt', ${now}) WHERE id = ${id}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STATUS_RANK: Record<string, number> = { DECIDED: 0, FINISHED: 0, IN_PROCESS: 1, PENDING: 1, ALLOCATE: 1, DECLINED: 2, REGISTER: 3 };
const asArray = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data ?? []);

/** Portal xatosi (sessiya eskirgan / server) — bunday javobni «sudya yo'q» deb qabul qilib bo'lmaydi. */
class PortalError extends Error {}
function assertPortalOk(r: { status: number }, what: string): void {
  if (r.status === 401 || r.status === 403 || r.status >= 500) throw new PortalError(`${what}: HTTP ${r.status}`);
}

/** Detaldagi HAQIQIY case_id (histories/appealable shu id bilan ishlaydi; ro'yxatdagi case_id boshqacha). */
function realCaseIdFromDetail(d: any): string | null {
  for (const p of Array.isArray(d?.participants) ? d.participants : []) { const id = p?.participant?.case_id; if (id) return String(id); }
  return null;
}

/**
 * SUDYA — get-one-case-by-id'dagi `chairman` deyarli doim bo'sh (2026-09-29 tekshiruvi: sudyasi borlarda
 * ham null). Haqiqiy manba (scripts/spiska-load-detail.ts bilan bir xil): (1) histories →
 * case_responsible_judge_full_name + sud nomi; (2) zaxira: appealable-documents → JUDGE hujjati egasi.
 */
async function fetchJudge(session: CabinetSession, realId: string): Promise<{ judge: string | null; court: string | null }> {
  let judge: string | null = null; let court: string | null = null;
  const h = await cabinetFetch(session, `/api/cabinet/case/conflict-suit-view/histories/${realId}`);
  assertPortalOk(h, 'histories');
  const hi = asArray(h.json)[0];
  judge = (hi?.case_responsible_judge_full_name || '').trim() || null;
  court = hi?.case_court?.names?.uz ?? hi?.case_court?.names?.uz_cyr ?? null;
  if (!judge) {
    const a = await cabinetFetch(session, `/api/cabinet/case/appealable-documents/${realId}`);
    assertPortalOk(a, 'appealable-documents');
    const docs = asArray(a.json);
    const jd = docs.find((d: any) => d?.document_group === 'JUDGE') ?? docs[0];
    judge = (jd?.owner_name || '').trim() || null;
  }
  return { judge, court };
}

/** Sudya (topilsa) + sud nomi + «tekshirildi» belgisi. Mavjud sudya bo'sh qiymat bilan o'chirilmaydi. */
async function saveJudge(id: number, judge: string | null, court: string | null): Promise<void> {
  const now = new Date().toISOString();
  if (judge) await prisma.clientCaseStatus.update({ where: { id }, data: { judge } });
  if (court) {
    await prisma.$executeRaw`
      UPDATE ClientCaseStatus SET detail = JSON_SET(COALESCE(detail, JSON_OBJECT()), '$._checkedAt', ${now}, '$.courtNameUz', ${court}) WHERE id = ${id}`;
  } else await stampChecked(id);
}

export async function runJudgeSync(opts: {
  firms: { branchCode: string; stir: string; name: string }[];
  sessionFor: (stir: string) => Promise<CabinetSession>;
  mibReportId: number | null;
  shouldStop: () => Promise<boolean>;
  log: (m: string) => void;
}): Promise<JudgeSyncState> {
  const st: JudgeSyncState = {
    ...EMPTY_JUDGE_STATE, running: true, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(),
    mibReportId: opts.mibReportId,
  };
  const beat = async (patch: Partial<JudgeSyncState> = {}) => {
    Object.assign(st, patch, { heartbeatAt: new Date().toISOString() });
    await writeJudgeState(st).catch(() => {});
  };

  const [pending, reportBases, anyMibBases] = await Promise.all([
    judgePending(), opts.mibReportId ? mibCourtBases(opts.mibReportId) : Promise.resolve(new Set<string>()), mibCourtBases(null),
  ]);
  // Ustuvorlik: shu MIB hisoboti → boshqa MIB ishlari → hal qilingan (DECIDED/FINISHED) → qolganlari.
  const rank = (r: PendingRow) =>
    (reportBases.has(r.caseNumber) ? 0 : anyMibBases.has(r.caseNumber) ? 10 : 20) + (STATUS_RANK[r.status] ?? 4);
  pending.sort((a, b) => rank(a) - rank(b));
  await beat({ total: pending.length });
  opts.log(`[sudya] boshlandi: ${pending.length} ta ish (MIB hisoboti: ${opts.mibReportId ?? '—'})`);

  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } });
  // Firmalar tartibi — eng ustuvor ishi bor firma birinchi.
  const firstIdx = new Map<string, number>();
  pending.forEach((p, i) => { if (!firstIdx.has(p.branchCode)) firstIdx.set(p.branchCode, i); });
  const firms = opts.firms.filter((f) => firstIdx.has(f.branchCode)).sort((a, b) => firstIdx.get(a.branchCode)! - firstIdx.get(b.branchCode)!);

  outer:
  for (const f of firms) {
    const mine = pending.filter((p) => p.branchCode === f.branchCode);
    await beat({ firm: f.name });
    let session: CabinetSession;
    try { session = await opts.sessionFor(f.stir); }
    catch (e) {
      opts.log(`[sudya] ${f.name}: sessiya yo'q — ${(e as Error).message?.slice(0, 120)}`);
      await beat({ failed: st.failed + mine.length, done: st.done + mine.length });
      continue;
    }
    // Ro'yxat (list case_id) FAQAT detali yo'q ishlar uchun kerak — detali borida haqiqiy case_id bazada.
    let idByNumber: Map<string, string> | null = null;
    if (mine.some((p) => !p.realId)) {
      idByNumber = new Map((await listCabinetCaseIds(session)).map((c) => [c.caseNumber, c.caseId]));
      // Bo'sh ro'yxat = ulanish/sessiya muammosi → detalsiz ishlarni BELGILAMAYMIZ (keyingi yurishda).
      if (idByNumber.size === 0) { opts.log(`[sudya] ${f.name}: ro'yxat bo'sh — detalsiz ishlar keyingi yurishga qoldi`); idByNumber = null; }
    }
    let firmErr = 0;
    for (const p of mine) {
      if (await opts.shouldStop()) { st.stopped = true; break outer; }
      try {
        let realId = p.realId;
        if (!realId) {
          if (!idByNumber) { await beat({ done: st.done + 1, failed: st.failed + 1 }); continue; } // ro'yxat yo'q — belgilamaymiz
          const listId = idByNumber.get(p.caseNumber);
          if (!listId) { await stampChecked(p.id); await beat({ done: st.done + 1 }); continue; } // portal ro'yxatida yo'q
          const r = await cabinetFetch(session, `/api/cabinet/case/get-one-case-by-id/${listId}`);
          assertPortalOk(r, 'detail');
          await applyCaseDetail(p.branchCode, p.caseNumber, r.json ?? {}, snap?.id ?? null);
          realId = realCaseIdFromDetail(r.json) ?? listId;
        }
        const { judge, court } = await fetchJudge(session, realId);
        await saveJudge(p.id, judge, court);
        firmErr = 0;
        await beat({ done: st.done + 1, found: st.found + (judge ? 1 : 0) });
      } catch (e) {
        // Portal/tarmoq xatosi — BELGILAMAYMIZ (keyinroq qayta urinadi). Firmada ketma-ket 5 xato =
        // sessiya eskirgan yoki blok alomati: bu firmani qoldirib keyingisiga o'tamiz.
        firmErr += 1;
        await beat({ done: st.done + 1, failed: st.failed + 1 });
        if (firmErr >= 5) {
          const left = mine.length - mine.indexOf(p) - 1;
          st.note = `${f.name}: cabinet ketma-ket javob bermadi (${(e as Error).message?.slice(0, 60)}) — keyinroq davom etadi`;
          opts.log(`[sudya] ${st.note}`);
          await beat({ done: st.done + left, failed: st.failed + left });
          continue outer;
        }
      }
      await sleep(DETAIL_FETCH_INTERVAL_MS);
    }
  }

  await beat({ running: false, finishedAt: new Date().toISOString(), firm: null });
  opts.log(`[sudya] tugadi: ${st.done}/${st.total} tekshirildi, ${st.found} ta sudya topildi, ${st.failed} xato${st.stopped ? ' (to\'xtatildi)' : ''}`);
  return st;
}
