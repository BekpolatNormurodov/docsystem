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

/** Worker'ga sinxron so'rovi. mibReportId berilsa — o'sha MIB hisobotining ishlari BIRINCHI. */
export async function requestJudgeSync(mibReportId: number | null = null, retryAt: Date | null = null): Promise<void> {
  const value = JSON.stringify({ at: new Date().toISOString(), mibReportId, retryAt: retryAt?.toISOString() ?? null });
  await prisma.setting.upsert({ where: { key: JUDGE_SYNC_REQUEST }, create: { key: JUDGE_SYNC_REQUEST, value }, update: { value } });
  await prisma.setting.deleteMany({ where: { key: JUDGE_SYNC_STOP } });
}

interface PendingRow { id: number; branchCode: string; caseNumber: string; status: string }

/**
 * Sudyasi yo'q, sudga tushgan (raqami «2-1004-…/…» ko'rinishida) va yaqinda tekshirilmagan ishlar.
 * CREATED/DRAFT — hali sudga tushmagan, sudya bo'lmaydi.
 */
export async function judgePending(): Promise<PendingRow[]> {
  const since = new Date(Date.now() - JUDGE_RECHECK_DAYS * 86_400_000).toISOString();
  return prisma.$queryRaw<PendingRow[]>`
    SELECT id, branchCode, caseNumber, status FROM ClientCaseStatus
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

  let consecutiveErr = 0;
  outer:
  for (const f of firms) {
    const mine = pending.filter((p) => p.branchCode === f.branchCode);
    await beat({ firm: f.name });
    let session: CabinetSession;
    let idByNumber: Map<string, string>;
    try {
      session = await opts.sessionFor(f.stir);
      idByNumber = new Map((await listCabinetCaseIds(session)).map((c) => [c.caseNumber, c.caseId]));
    } catch (e) {
      opts.log(`[sudya] ${f.name}: sessiya/ro'yxat xatosi — ${(e as Error).message?.slice(0, 120)}`);
      await beat({ failed: st.failed + mine.length, done: st.done + mine.length });
      continue;
    }
    for (const p of mine) {
      if (await opts.shouldStop()) { st.stopped = true; break outer; }
      const caseId = idByNumber.get(p.caseNumber);
      if (!caseId) { await stampChecked(p.id); await beat({ done: st.done + 1 }); continue; } // portal ro'yxatida yo'q
      try {
        const r = await cabinetFetch(session, `/api/cabinet/case/get-one-case-by-id/${caseId}`);
        const applied = await applyCaseDetail(p.branchCode, p.caseNumber, r.json ?? {}, snap?.id ?? null);
        if (!applied) await stampChecked(p.id);
        consecutiveErr = 0;
        await beat({ done: st.done + 1, found: st.found + (applied?.judge ? 1 : 0) });
      } catch (e) {
        // Tarmoq/portal xatosi — belgilamaymiz (keyinroq qayta urinadi). Ketma-ket ko'p xato = blok
        // alomati: portalga bosim bermaslik uchun shu yurishni to'xtatamiz, worker keyinroq davom ettiradi.
        consecutiveErr += 1;
        await beat({ done: st.done + 1, failed: st.failed + 1 });
        if (consecutiveErr >= 8) { st.note = 'cabinet ketma-ket javob bermadi — keyinroq davom etadi'; opts.log(`[sudya] ${st.note}`); break outer; }
      }
      await sleep(DETAIL_FETCH_INTERVAL_MS);
    }
  }

  await beat({ running: false, finishedAt: new Date().toISOString(), firm: null });
  opts.log(`[sudya] tugadi: ${st.done}/${st.total} tekshirildi, ${st.found} ta sudya topildi, ${st.failed} xato${st.stopped ? ' (to\'xtatildi)' : ''}`);
  return st;
}
