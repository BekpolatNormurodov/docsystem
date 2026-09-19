// src/lib/court-send-suits.ts
// «SUDGA O'TKAZISH» (/sud 3-tab) — ADOLAT'da ALLAQACHON SAQLANGAN suit'larni (stop-B, «Murojaatlarim»
// dagi CREATED ish) send-to-court bilan sudga topshirish. 2026-09-19 foydalanuvchi qarori: REAL
// yuborish FAQAT shu yerdan (eski «prepare-ready draftMode'siz» va real navbatni avto-davom
// ettirish to'xtatildi). Bu yo'l YANGI save-suit QILMAYDI — faqat mavjud meta.cabinetCaseId'ni
// PUT send-to-court/{id} bilan yuboradi, shuning uchun bir odamga ikkinchi da'vo ochilmaydi.
//
// NEGA ALOHIDA MODUL (court-submit-job'ning yangi rejimi emas): u dvigatel har ishda qoralama →
// hujjatlar → save-suit qiladi; bu yerda esa ish 1-2 so'rovdan iborat va xavf profili butunlay
// boshqa (qaytarib bo'lmaydigan yakuniy qadam). Job turi baribir 'COURT_SUBMIT' (params.sendSuits):
// worker sikli, «bir vaqtda bitta sud partiyasi» to'siqlari va restart-tiklash o'z-o'zidan ishlaydi.
//
// XAVFSIZLIK QATLAMLARI (har biri alohida — biri teshilsa boshqasi ushlaydi):
//   1) Job yaratishda: env CABINET_ALLOW_SEND_TO_COURT=1, umumiy + firma pauzasi (FAIL-CLOSED),
//      shu foydalanuvchining ≤10 daqiqalik tasdiqlangan E-IMZO attestatsiyasi, har ish DB bo'yicha
//      yaroqli, sud kunlik limiti (sud QAYTA BIRIKTIRILMAYDI — suit'da sud allaqachon muhrlangan).
//   2) Har ishdan OLDIN (job ichida): bekor, pauza (fail-closed), env, sud oynasi, DB qayta tekshiruv.
//   3) JONLI tekshiruv FIRMANING O'Z sessiyasi bilan (env CABINET_TOKEN HECH QACHON): portal
//      ro'yxatida ish CREATED, da'vogar shu firma, shu javobgarga boshqa ochiq/CREATED ish yo'q;
//      detalda javobgar PINFL = bizning PINFL.
//   4) PUT'dan oldin meta.courtSend=SENDING ATOMAR yoziladi (ikki jarayon bitta ishni yubormasin);
//      worker uzilsa SENDING → CHECK (qo'lda tekshirish), limit bo'shatilmaydi.
//   5) Noaniq javob (timeout/5xx/tarmoq): holat portaldan qayta o'qiladi — CREATED'dan o'tgan
//      bo'lsa muvaffaqiyat, hali CREATED bo'lsa FAILED, o'qilmasa CHECK.
import { Prisma } from '@prisma/client';
import type { CaseStage } from '@prisma/client';
import { prisma } from './db';
import { enqueueJob } from './job-dispatch';
import { getStoredCabinetSession } from './cabinet/session';
import { paceCase, backoff, caseGapFor } from './cabinet/pacer';
import { normName } from './cabinet/status-ingest';
import { FIRMS } from './firms';
import { firmActivity } from './active-firms';
import { konveyerSnapshots } from './konveyer';
import { audit, AuditAction } from './audit';
import { allocateFirmCases, consumeCourtSend, releaseCourtSend, firmCourtBudgets, courtWindow } from './court-routing';
import { paidReceiptSet, deliveryRequiredFirmIds, hasDeliveryProof } from './court-ready';
import { noteQueueBlocked, resetQueueBackoff } from './court-auto-resume';
import { CabinetApiClient, CabinetRequestError } from '../../cabinet-api-skeleton/client';
import { CABINET_ENDPOINTS, resolveCabinetCourtGuid } from '../../cabinet-api-skeleton/constants';
import type { TFn } from './i18n/core';

// ── Kontrakt turlari (SUD_TABS_SPEC.md «Tab 3 backend») ─────────────────────────────────────────

export type SendBlocker =
  | 'NO_CASE_ID' | 'SUBMITTED' | 'HELD' | 'BOJI_UNPAID' | 'NO_DELIVERY'
  | 'OLD_PACKAGE' | 'PORTAL_NOT_CREATED' | 'QUEUED' | 'SENDING' | 'CHECK';

export const SEND_BLOCKERS: SendBlocker[] = [
  'NO_CASE_ID', 'SUBMITTED', 'HELD', 'BOJI_UNPAID', 'NO_DELIVERY',
  'OLD_PACKAGE', 'PORTAL_NOT_CREATED', 'QUEUED', 'SENDING', 'CHECK',
];

export type CourtSendState = 'SENDING' | 'SENT' | 'FAILED' | 'CHECK';

/** ArizaCase.meta.courtSend — ish bo'yicha yuborish holati (CourtQueueItem EMAS: u suit-navbatniki). */
export interface CourtSendMeta {
  state: CourtSendState;
  at: string;
  /** QAYSI suit uchun yozilgan. Qaytgan ish qayta tayyorlansa (yangi cabinetCaseId) eski SENT/CHECK
   *  yangi suit'ni abadiy to'sib qo'ymasligi uchun holat faqat o'z suit'iga taalluqli. */
  cabinetCaseId?: string;
  jobId?: number;
  userId?: number | null;
  error?: string;
}

export interface SendGate {
  envAllowed: boolean;
  globalPaused: boolean;
  firms: { firmId: number; firmName: string; paused: boolean; attestedAt: string | null; attestFresh: boolean }[];
}

export interface SendRow {
  caseId: number; firmId: number; firmName: string; clientName: string | null; pinfl: string | null;
  courtName: string | null; cabinetCaseId: string; suitReadyAt: string; portalStatus: string | null; portalCheckedAt: string | null;
  bojiPaid: boolean; delivered: boolean; blockers: SendBlocker[]; eligible: boolean;
  send: { state: CourtSendState; at: string; error?: string } | null; totalDebt: number | null;
}

export interface SendCounts { total: number; eligible: number; byBlocker: Record<SendBlocker, number> }

export interface ActiveCourtJob { id: number; firmId: number; kind: 'send' | 'draft' | 'real'; progress: number; total: number }

// ── Doimiylar ─────────────────────────────────────────────────────────────────────────────────

/** Bir partiyada eng ko'pi — sud kunlik limitidan tashqari, operator ko'zdan kechira oladigan hajm. */
export const MAX_SEND_BATCH = 100;

/**
 * PAKET TUZATISHLARI shu paytda kuchga kirgan (2026-09-18 ~11:57 +05:00 = 06:57Z): birlashtirilgan
 * ofertalar + grafik (a2f3f25/f78671a), yetkazilgan check (0174d58), boshqa firma xatisiz (4ae28cd/
 * 1628da7). save-suit'dan keyin ishga hujjat qo'shib bo'lmaydi, ya'ni undan OLDIN saqlangan suit
 * nosoz paket bilan muhrlangan — yuborilsa «hujjatlar tartibsiz» deb qaytadi (adolat-decline-reasons).
 */
export const SUIT_PACKAGE_FIXED_AT = Date.parse('2026-09-18T06:57:00Z');

/** Attestatsiya (court-sign yozadi) shuncha vaqt yaroqli. */
export const ATTEST_TTL_MS = 10 * 60_000;
export const ATTEST_PREFIX = 'court_send_attest:';

/** Job yaratilgandan keyin shuncha kutib qolgan bo'lsa — inson tasdig'i eskirgan, yubormaymiz. */
const JOB_START_MAX_AGE_MS = 30 * 60_000;

const PAUSE_KEY = 'court_queue_paused';
const SENT_STAGE_LIST: CaseStage[] = ['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED'];
const SENT_STAGES = new Set<CaseStage>(SENT_STAGE_LIST);
// Portalda sudga topshirilgan (CREATED'dan o'tgan) holatlar — court-ready COURT_ACTIVE_STATUSES bilan bir xil.
const COURT_ACTIVE_STATUSES = ['ALLOCATE', 'REGISTER', 'PENDING', 'IN_PROCESS'];
// Shu javobgarga «ikkinchi da'vo» bo'ladigan holatlar: yuborilgan (faol) YOKI yana bitta CREATED suit.
const SIBLING_BLOCK_STATUSES = new Set(['CREATED', ...COURT_ACTIVE_STATUSES]);
const MAX_CONSECUTIVE_BLOCKED = 3;

// Worker'da so'rov konteksti yo'q (currentUser() yiqiladi) — aktyor aniq beriladi.
const SEND_ACTOR_FALLBACK = { username: 'tizim (sudga o‘tkazish)', role: 'system' };

const digits = (s?: string | number | null) => String(s ?? '').replace(/\D+/g, '');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const idT: TFn = (s) => s;

type Meta = Record<string, any>;
const metaObj = (m: unknown): Meta => (m && typeof m === 'object' && !Array.isArray(m) ? { ...(m as Meta) } : {});

function courtSendOf(meta: Meta): CourtSendMeta | null {
  const c = meta.courtSend;
  if (!c || typeof c !== 'object') return null;
  const st = String(c.state ?? '');
  if (st !== 'SENDING' && st !== 'SENT' && st !== 'FAILED' && st !== 'CHECK') return null;
  // Boshqa (eski) suit'ning holati — hozirgi suit'ga tegishli emas (qaytib, qayta tayyorlangan ish).
  if (c.cabinetCaseId && meta.cabinetCaseId && String(c.cabinetCaseId) !== String(meta.cabinetCaseId)) return null;
  return { state: st, at: String(c.at ?? ''), cabinetCaseId: c.cabinetCaseId ? String(c.cabinetCaseId) : undefined, jobId: c.jobId, userId: c.userId, error: c.error ?? undefined };
}

/**
 * Bu suit sud tomonidan QAYTARILGAN suitmi. outcome-sync (Detection A) qaytganda courtCaseId'ni
 * tozalaydi, lekin suitReadyAt/cabinetCaseId'ni QOLDIRADI — ya'ni o'lik suit bu ro'yxatga qaytib
 * tushardi. Qayta tayyorlangan (suitReadyAt > declinedAt, yangi cabinetCaseId) suit esa tirik.
 */
function isDeclinedSuit(meta: Meta): boolean {
  if (!meta.declinedAt) return false;
  if (meta.declinedCaseId && meta.cabinetCaseId && String(meta.declinedCaseId) === String(meta.cabinetCaseId)) return true;
  const s = Date.parse(String(meta.suitReadyAt ?? ''));
  const d = Date.parse(String(meta.declinedAt));
  return Number.isFinite(s) && Number.isFinite(d) && s <= d;
}

// ── DB tanlov + to'siqlar ─────────────────────────────────────────────────────────────────────

const CASE_SELECT = {
  id: true, firmId: true, snapshotId: true, pinfl: true, clientName: true, stage: true,
  courtCaseId: true, courtId: true, courtSentAt: true, receiptNumber: true, invoiceNo: true,
  totalDebt: true, meta: true,
  court: true,
  firm: { select: { id: true, shortName: true, code: true, stir: true, active: true } },
} satisfies Prisma.ArizaCaseSelect;
type CaseRow = Prisma.ArizaCaseGetPayload<{ select: typeof CASE_SELECT }>;

interface EligCtx {
  paid: Set<string>;
  deliveryRequired: Set<number>;
  queued: Set<number>;
  portal: Map<string, { status: string; at: Date }>;
  /** `${branchCode}|${pinfl}` — portalda shu firma nomidan sudga topshirilgan ish bor (aniq PINFL). */
  courtActive: Set<string>;
  /** `${firmId}|${pinfl}` → sudda turgan (yoki portalda izi bor) BOSHQA ArizaCase id'lari. */
  sentSiblings: Map<string, number[]>;
}

async function loadEligCtx(cases: CaseRow[]): Promise<EligCtx> {
  const ids = cases.map((c) => c.id);
  const cabIds = [...new Set(cases.map((c) => String(metaObj(c.meta).cabinetCaseId ?? '')).filter(Boolean))];
  const pinfls = [...new Set(cases.map((c) => c.pinfl).filter((p): p is string => !!p))];
  const firmIds = [...new Set(cases.map((c) => c.firmId))];
  const codes = [...new Set(cases.map((c) => c.firm?.code).filter((x): x is string => !!x))];
  const empty = <T>(v: T) => Promise.resolve(v);

  const [paid, deliveryRequired, queuedRows, portalRows, activeRows, siblingRows] = await Promise.all([
    paidReceiptSet(cases.map((c) => c.receiptNumber ?? '')),
    deliveryRequiredFirmIds(),
    ids.length
      ? prisma.courtQueueItem.findMany({ where: { caseId: { in: ids }, state: { in: ['PENDING', 'RUNNING'] } }, select: { caseId: true } })
      : empty([] as { caseId: number }[]),
    cabIds.length
      ? prisma.clientCaseStatus.findMany({
          where: { source: 'CABINET', OR: [{ caseNumber: { in: cabIds } }, { claimId: { in: cabIds } }] },
          select: { caseNumber: true, claimId: true, status: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        })
      : empty([] as { caseNumber: string | null; claimId: string | null; status: string; updatedAt: Date }[]),
    pinfls.length && codes.length
      ? prisma.clientCaseStatus.findMany({
          where: { source: 'CABINET', matchedBy: 'PINFL', branchCode: { in: codes }, pinfl: { in: pinfls }, status: { in: COURT_ACTIVE_STATUSES } },
          select: { branchCode: true, pinfl: true },
        })
      : empty([] as { branchCode: string; pinfl: string | null }[]),
    pinfls.length
      ? prisma.arizaCase.findMany({
          where: {
            firmId: { in: firmIds }, pinfl: { in: pinfls },
            // Sudda turgan (COURT_SUBMITTED), portalda izi bor yoki sud QABUL QILGAN (COURT_ACCEPTED) ish.
            // COURT_ACCEPTED ham to'siq (2026-09-19 kod ko'rigi): outcome-sync REGISTER/PENDING/IN_PROCESS
            // (ochiq, ko'rilayotgan) ishni ham COURT_ACCEPTED qiladi — faqat portalStatus hal bo'lgan
            // (DECIDED/FINISHED) bo'lsa pastda chiqarib tashlanadi. MIB/CLOSED — yakunlangan, to'siq emas.
            OR: [
              { stage: { in: ['COURT_SUBMITTED', 'COURT_ACCEPTED'] } },
              { courtCaseId: { not: null }, stage: { notIn: ['COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED'] } },
            ],
          },
          select: { id: true, firmId: true, pinfl: true, stage: true, meta: true },
        })
      : empty([] as { id: number; firmId: number; pinfl: string | null; stage: CaseStage; meta: unknown }[]),
  ]);

  const portal = new Map<string, { status: string; at: Date }>();
  const cabSet = new Set(cabIds);
  // Eng yangi yozuv birinchi (orderBy updatedAt desc) — birinchi uchragani saqlanadi.
  for (const r of portalRows) {
    for (const k of [r.caseNumber, r.claimId]) {
      if (k && cabSet.has(k) && !portal.has(k)) portal.set(k, { status: String(r.status || '').toUpperCase(), at: r.updatedAt });
    }
  }
  const stirByCode = new Map(cases.map((c) => [c.firm?.code ?? '', digits(c.firm?.stir)]));
  const courtActive = new Set<string>();
  for (const r of activeRows) {
    if (!r.pinfl) continue;
    if (stirByCode.get(r.branchCode) && r.pinfl === stirByCode.get(r.branchCode)) continue; // firma o'zi (da'vogar)
    courtActive.add(`${r.branchCode}|${r.pinfl}`);
  }
  const sentSiblings = new Map<string, number[]>();
  for (const r of siblingRows) {
    if (!r.pinfl) continue;
    // Sud qabul qilgan-u, portalda HAL BO'LGAN ish — yangi qarz bo'yicha da'voga to'siq emas.
    if (r.stage === 'COURT_ACCEPTED' && ['DECIDED', 'FINISHED'].includes(String(metaObj(r.meta).portalStatus ?? '').toUpperCase())) continue;
    const k = `${r.firmId}|${r.pinfl}`;
    if (!sentSiblings.has(k)) sentSiblings.set(k, []);
    sentSiblings.get(k)!.push(r.id);
  }
  return { paid, deliveryRequired, queued: new Set(queuedRows.map((q) => q.caseId)), portal, courtActive, sentSiblings };
}

function evaluate(c: CaseRow, ctx: EligCtx): { blockers: SendBlocker[]; bojiPaid: boolean; delivered: boolean; portal: { status: string; at: Date } | null } {
  const m = metaObj(c.meta);
  const blockers: SendBlocker[] = [];
  const cabId = m.cabinetCaseId ? String(m.cabinetCaseId) : '';
  const send = courtSendOf(m);
  const portal = cabId ? ctx.portal.get(cabId) ?? null : null;
  const bojiPaid = !!c.receiptNumber && ctx.paid.has(c.receiptNumber);
  const delivered = hasDeliveryProof(c.meta);

  if (!m.suitReadyAt || !cabId) blockers.push('NO_CASE_ID');
  // SUBMITTED — «allaqachon sudda» (biz yoki yurist): courtCaseId / sud bosqichi / SENT belgisi,
  // portalda shu odamga shu firmadan FAOL sud ishi (aniq PINFL), yoki shu firmaning BOSHQA
  // qatorida sudda turgan ish (yangi snapshot eski yuborilganni takrorlamasin).
  const sib = c.pinfl ? (ctx.sentSiblings.get(`${c.firmId}|${c.pinfl}`) ?? []).filter((id) => id !== c.id) : [];
  if (
    c.courtCaseId || SENT_STAGES.has(c.stage) || send?.state === 'SENT' || sib.length > 0
    || (c.pinfl && c.firm?.code && ctx.courtActive.has(`${c.firm.code}|${c.pinfl}`))
  ) blockers.push('SUBMITTED');
  if (m.resendHold != null) blockers.push('HELD');
  if (!bojiPaid) blockers.push('BOJI_UNPAID');
  if (ctx.deliveryRequired.has(c.firmId) && !delivered) blockers.push('NO_DELIVERY');
  const readyAt = Date.parse(String(m.suitReadyAt ?? ''));
  if (m.suitReadyAt && !(Number.isFinite(readyAt) && readyAt >= SUIT_PACKAGE_FIXED_AT)) blockers.push('OLD_PACKAGE');
  // Portal holati BAZADAN (30 daq sinxron). CREATED'dan boshqa (yurist yuborgan, qaytgan) — to'siq.
  // Qaytarilgan suit (outcome-sync meta'ni qoldiradi) ham shu yerga tushadi.
  if ((portal && portal.status && portal.status !== 'CREATED') || isDeclinedSuit(m)) blockers.push('PORTAL_NOT_CREATED');
  if (ctx.queued.has(c.id)) blockers.push('QUEUED');
  if (send?.state === 'SENDING') blockers.push('SENDING');
  if (send?.state === 'CHECK') blockers.push('CHECK');
  return { blockers, bojiPaid, delivered, portal };
}

/** Tab 3 qatori bo'lishi uchun: saqlangan suit, sudga hali yubormagan, qaytarilgan suit emas. */
function isSuitRow(c: CaseRow): boolean {
  const m = metaObj(c.meta);
  return !!m.suitReadyAt && !!m.cabinetCaseId && !c.courtCaseId && !SENT_STAGES.has(c.stage) && !isDeclinedSuit(m);
}

function emptyByBlocker(): Record<SendBlocker, number> {
  return Object.fromEntries(SEND_BLOCKERS.map((b) => [b, 0])) as Record<SendBlocker, number>;
}

/**
 * GET /konveyer/sud-send qatorlari. Tanlangan (yoki eng oxirgi) snapshot; faqat faol firmalar;
 * (firma, PINFL) bo'yicha takror bo'lsa eng yangi suitReadyAt qoladi. Portal holati — faqat DB
 * (jonli tekshiruv job ichida).
 */
export async function listSendableSuits(opts: { firmId?: number; snapshotId?: number } = {}): Promise<{ rows: SendRow[]; counts: SendCounts }> {
  const snapshotId = opts.snapshotId ?? (await konveyerSnapshots())[0]?.id;
  const fa = await firmActivity();
  if (opts.firmId && !fa.isActiveId(opts.firmId)) return { rows: [], counts: { total: 0, eligible: 0, byBlocker: emptyByBlocker() } };

  const cases = (await prisma.arizaCase.findMany({
    where: {
      ...(snapshotId ? { snapshotId } : {}),
      ...(opts.firmId ? { firmId: opts.firmId } : {}),
      ...fa.caseWhere,
      courtCaseId: null,
      stage: { notIn: SENT_STAGE_LIST },
    },
    select: CASE_SELECT,
  })).filter((c) => isSuitRow(c) && c.firm?.active !== false);

  // (firma, PINFL) takrori — eng yangi suit qoladi (eski suit portalda CREATED bo'lib qolgan bo'lsa,
  // uni jonli tekshiruv «boshqa CREATED ish» deb baribir to'sadi).
  const newest = new Map<string, CaseRow>();
  const noPinfl: CaseRow[] = [];
  for (const c of cases) {
    if (!c.pinfl) { noPinfl.push(c); continue; }
    const k = `${c.firmId}|${c.pinfl}`;
    const prev = newest.get(k);
    const at = (x: CaseRow) => Date.parse(String(metaObj(x.meta).suitReadyAt ?? '')) || 0;
    if (!prev || at(c) > at(prev)) newest.set(k, c);
  }
  const picked = [...newest.values(), ...noPinfl];
  const ctx = await loadEligCtx(picked);

  const byBlocker = emptyByBlocker();
  const rows: SendRow[] = picked.map((c) => {
    const m = metaObj(c.meta);
    const ev = evaluate(c, ctx);
    for (const b of ev.blockers) byBlocker[b]++;
    const send = courtSendOf(m);
    return {
      caseId: c.id, firmId: c.firmId, firmName: c.firm?.shortName ?? '', clientName: c.clientName, pinfl: c.pinfl,
      courtName: c.court?.shortName ?? null, cabinetCaseId: String(m.cabinetCaseId), suitReadyAt: String(m.suitReadyAt),
      portalStatus: ev.portal?.status ?? null, portalCheckedAt: ev.portal?.at.toISOString() ?? null,
      bojiPaid: ev.bojiPaid, delivered: ev.delivered, blockers: ev.blockers, eligible: ev.blockers.length === 0,
      send: send ? { state: send.state, at: send.at, ...(send.error ? { error: send.error } : {}) } : null,
      totalDebt: c.totalDebt != null ? Number(c.totalDebt) : null,
    };
  });
  rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.firmName.localeCompare(b.firmName) || b.suitReadyAt.localeCompare(a.suitReadyAt));
  return { rows, counts: { total: rows.length, eligible: rows.filter((r) => r.eligible).length, byBlocker } };
}

// ── Gate: env, pauza, attestatsiya ────────────────────────────────────────────────────────────

interface Attest { userId: number | null; at: string; verified: boolean }
function parseAttest(v: string | null | undefined): Attest | null {
  if (!v) return null;
  try {
    const j = JSON.parse(v);
    if (!j || typeof j !== 'object' || !j.at) return null;
    return { userId: j.userId != null ? Number(j.userId) : null, at: String(j.at), verified: j.verified === true };
  } catch { return null; }
}
function attestTimeOk(a: Attest, now = Date.now()): boolean {
  const t = Date.parse(a.at);
  // Kelajakdagi vaqt (soat farqi) ham qabul qilinmaydi — 1 daqiqa chidam.
  return Number.isFinite(t) && t <= now + 60_000 && now - t <= ATTEST_TTL_MS;
}
function attestFresh(a: Attest | null, userId: number | null | undefined, now = Date.now()): boolean {
  if (!a || !a.verified || userId == null || a.userId !== userId) return false;
  return attestTimeOk(a, now);
}

/** Court-sign muvaffaqiyatidan keyin chaqiriladi (route o'zi yozadi — bu faqat o'qish uchun). */
export const attestKey = (firmId: number) => `${ATTEST_PREFIX}${firmId}`;

/**
 * Pauza holatini QAT'IY o'qiydi. pacer.isQueuePaused DB xatosida `false` (FAIL-OPEN) qaytaradi —
 * qoralama uchun bu to'g'ri (ish to'xtab qolmasin), lekin qaytarib bo'lmaydigan yuborishda
 * «o'qib bo'lmadi» = «pauzada» deb hisoblanadi (FAIL-CLOSED).
 */
async function pauseStrict(firmId: number): Promise<{ global: boolean; firm: boolean; error: string | null }> {
  try {
    const rows = await prisma.setting.findMany({ where: { key: { in: [PAUSE_KEY, `${PAUSE_KEY}:${firmId}`] } }, select: { key: true, value: true } });
    return {
      global: rows.some((r) => r.key === PAUSE_KEY && r.value === '1'),
      firm: rows.some((r) => r.key === `${PAUSE_KEY}:${firmId}` && r.value === '1'),
      error: null,
    };
  } catch (e) {
    return { global: true, firm: true, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendGate(opts: { userId?: number | null } = {}): Promise<SendGate> {
  const envAllowed = process.env.CABINET_ALLOW_SEND_TO_COURT === '1';
  const firms = await prisma.firm.findMany({ where: { active: true }, select: { id: true, shortName: true }, orderBy: { id: 'asc' } });
  let settings: { key: string; value: string }[] = [];
  let dbOk = true;
  try {
    settings = await prisma.setting.findMany({
      where: { OR: [{ key: PAUSE_KEY }, { key: { startsWith: `${PAUSE_KEY}:` } }, { key: { startsWith: ATTEST_PREFIX } }] },
      select: { key: true, value: true },
    });
  } catch { dbOk = false; }
  const val = new Map(settings.map((s) => [s.key, s.value]));
  return {
    envAllowed,
    globalPaused: !dbOk || val.get(PAUSE_KEY) === '1',
    firms: firms.map((f) => {
      const a = parseAttest(val.get(attestKey(f.id)));
      return {
        firmId: f.id, firmName: f.shortName,
        paused: !dbOk || val.get(`${PAUSE_KEY}:${f.id}`) === '1',
        attestedAt: a?.at ?? null,
        attestFresh: attestFresh(a, opts.userId),
      };
    }),
  };
}

/** Ayni paytdagi COURT_SUBMIT partiyasi va uning turi (UI «nima ketyapti» deb ko'rsatadi). */
export async function activeCourtJob(): Promise<ActiveCourtJob | null> {
  const j = await prisma.job.findFirst({
    where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } },
    orderBy: { id: 'desc' },
    select: { id: true, progress: true, total: true, params: true },
  });
  if (!j) return null;
  const p = (j.params ?? {}) as { firmId?: number; sendSuits?: boolean; suitMode?: boolean; draftMode?: boolean };
  const kind: ActiveCourtJob['kind'] = p.sendSuits === true ? 'send' : (p.suitMode === true || p.draftMode === true) ? 'draft' : 'real';
  return { id: j.id, firmId: Number(p.firmId) || 0, kind, progress: j.progress, total: j.total };
}

// ── Job yaratish (POST /konveyer/sud-send) ────────────────────────────────────────────────────

export interface RejectedCase { caseId: number; blockers: string[] }
export interface ExcludedCase { caseId: number; reason: 'COURT_NOT_ASSIGNED' | 'COURT_NOT_ALLOWED' | 'QUOTA_OR_WINDOW' }
export type CreateSendResult =
  | { ok: true; jobId: number; total: number; excluded: ExcludedCase[] }
  | { ok: false; status: 400 | 404 | 409; error: string; rejected?: RejectedCase[]; excluded?: ExcludedCase[] };

export async function createSendSuitsJob(
  input: { firmId: number; caseIds: unknown; userId: number },
  t: TFn = idT,
): Promise<CreateSendResult> {
  const firmId = Number(input.firmId);
  if (!Number.isInteger(firmId) || firmId <= 0) return { ok: false, status: 400, error: t('firmId kerak') };
  const caseIds = [...new Set((Array.isArray(input.caseIds) ? input.caseIds : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (caseIds.length === 0) return { ok: false, status: 400, error: t('Ish tanlanmagan') };
  if (caseIds.length > MAX_SEND_BATCH) return { ok: false, status: 400, error: t('Bir partiyada eng ko‘pi 100 ta ish yuboriladi') };

  if (process.env.CABINET_ALLOW_SEND_TO_COURT !== '1') {
    return { ok: false, status: 400, error: t('Real yuborish serverda o‘chirilgan (CABINET_ALLOW_SEND_TO_COURT≠1)') };
  }

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, shortName: true, stir: true, active: true } });
  if (!firm) return { ok: false, status: 404, error: t('Firma topilmadi') };
  if (!firm.active) return { ok: false, status: 400, error: t('Firma nofaol') };
  if (!digits(firm.stir)) return { ok: false, status: 400, error: t('Firmada STIR yoʻq — sudga yuborishdan oldin STIR kiriting') };

  const pause = await pauseStrict(firmId);
  if (pause.error) return { ok: false, status: 409, error: t('Pauza holatini o‘qib bo‘lmadi — xavfsizlik uchun yuborilmaydi') };
  if (pause.global) return { ok: false, status: 409, error: t('Sudga yuborish umumiy pauzada. Avval pauzani oching.') };
  if (pause.firm) return { ok: false, status: 409, error: t('Bu firma pauzada. Avval firma pauzasini oching.') };

  // E-IMZO ATTESTATSIYASI (server tomonda). Ilgari imzo faqat brauzerda talab qilinardi —
  // job yaratuvchi route'lar imzo bo'lgan-bo'lmaganini tekshirmasdi. Endi court-sign yozgan
  // yozuv: shu foydalanuvchi, ≤10 daqiqa, tasdiqlangan (verified).
  const attRow = await prisma.setting.findUnique({ where: { key: attestKey(firmId) }, select: { value: true } }).catch(() => null);
  const att = parseAttest(attRow?.value);
  if (!att || !attestTimeOk(att)) {
    return { ok: false, status: 400, error: t('E-IMZO tasdig‘i yo‘q yoki eskirgan (10 daqiqadan oshgan). Firma kaliti bilan qayta tasdiqlang.') };
  }
  if (att.userId !== input.userId) return { ok: false, status: 400, error: t('E-IMZO tasdig‘i boshqa foydalanuvchiga tegishli. O‘zingiz qayta tasdiqlang.') };
  if (!att.verified) return { ok: false, status: 400, error: t('E-IMZO imzo egasi tasdiqlanmagan — real yuborish uchun tasdiqlangan imzo kerak.') };

  const active = await prisma.job.findFirst({ where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } }, select: { id: true } });
  if (active) return { ok: false, status: 409, error: `${t('Boshqa sud partiyasi ketmoqda')} (#${active.id}). ${t('Tugashini kuting.')}` };

  // HAR ISH QAYTA TEKSHIRILADI (UI ro'yxati eskirgan bo'lishi mumkin).
  const cases = await prisma.arizaCase.findMany({ where: { id: { in: caseIds } }, select: CASE_SELECT });
  const byId = new Map(cases.map((c) => [c.id, c]));
  const ctx = await loadEligCtx(cases);
  const rejected: RejectedCase[] = [];
  const seenPerson = new Set<string>();
  const ok: CaseRow[] = [];
  for (const id of caseIds) {
    const c = byId.get(id);
    if (!c) { rejected.push({ caseId: id, blockers: ['NOT_FOUND'] }); continue; }
    if (c.firmId !== firmId) { rejected.push({ caseId: id, blockers: ['OTHER_FIRM'] }); continue; }
    const ev = evaluate(c, ctx);
    const bl: string[] = [...ev.blockers];
    // Bitta so'rovda bir odamning ikki suit'i — ikkinchi da'vo. Ikkalasi ham rad etiladi emas,
    // birinchisi o'tadi (UI takrorni allaqachon yashiradi, bu faqat qo'lda yasalgan so'rov uchun).
    const pk = c.pinfl ? `${c.firmId}|${c.pinfl}` : null;
    if (pk && seenPerson.has(pk)) bl.push('DUPLICATE');
    if (bl.length) { rejected.push({ caseId: id, blockers: bl }); continue; }
    if (pk) seenPerson.add(pk);
    ok.push(c);
  }
  if (rejected.length) {
    return {
      ok: false, status: 400,
      error: `${t('Yuborishga yaroqsiz ishlar')}: ${rejected.length}. ${t('Ro‘yxatni yangilab, qaytadan tanlang.')}`,
      rejected,
    };
  }

  // SUD LIMITI — QAYTA BIRIKTIRMASDAN. allocateFirmCases case.courtId firma sudlari orasida
  // bo'lmasa uni ASOSIY sudga ko'chiradi; saqlangan suit'da esa sud portalda allaqachon muhrlangan
  // (court_id), ko'chirish DB'dagi sudni portaldagidan ayirib, limit hisobini buzardi. Shuning uchun
  // bunday ishlar chetga olinadi va operatorga aytiladi.
  const excluded: ExcludedCase[] = [];
  const budgets = await firmCourtBudgets(firmId);
  const allowedCourt = new Set(budgets.map((b) => b.court.id));
  const candidates: CaseRow[] = [];
  for (const c of ok) {
    if (!c.courtId) { excluded.push({ caseId: c.id, reason: 'COURT_NOT_ASSIGNED' }); continue; }
    if (budgets.length && !allowedCourt.has(c.courtId)) { excluded.push({ caseId: c.id, reason: 'COURT_NOT_ALLOWED' }); continue; }
    candidates.push(c);
  }
  let assignments: { caseId: number; courtId: number }[] = [];
  if (candidates.length) {
    const alloc = await allocateFirmCases(firmId, candidates.map((c) => c.id), new Date(), undefined, false);
    if (!alloc) {
      // Sud konfiguratsiyasi yo'q (eski xatti-harakat: cheklovsiz) — ishning o'z sudi qoladi.
      assignments = candidates.map((c) => ({ caseId: c.id, courtId: c.courtId! }));
    } else {
      const want = new Map(candidates.map((c) => [c.id, c.courtId!]));
      for (const a of alloc.assignments) {
        // Himoya: allokator sudni almashtirgan bo'lsa (bo'lmasligi kerak — yuqorida filtrlandi) — yubormaymiz.
        if (want.get(a.caseId) === a.courtId) assignments.push(a);
        else excluded.push({ caseId: a.caseId, reason: 'COURT_NOT_ALLOWED' });
      }
      for (const id of alloc.deferred) excluded.push({ caseId: id, reason: 'QUOTA_OR_WINDOW' });
    }
  }
  if (!assignments.length) {
    return {
      ok: false, status: 400,
      error: t('Bugun yuboriladigan ish qolmadi — sud oynasi yopiq, kunlik limit tugagan yoki sud firmaga biriktirilmagan.'),
      excluded,
    };
  }

  // Limit partiya BOSHIDA band qilinadi (real rejim bilan bir xil — poyga bo'lmasin); yuborilmagani
  // job oxirida / restart'da qaytariladi.
  const now = new Date();
  await consumeCourtSend(assignments, now, true);
  const sendIds = assignments.map((a) => a.caseId);
  const job = await prisma.job.create({
    data: {
      type: 'COURT_SUBMIT',
      status: 'PENDING',
      total: sendIds.length,
      // suitMode/draftMode ATAYIN yo'q: draftAutoTick «buzuq firma» hisobi va auto-resume bu
      // partiyani qoralama deb o'qimasin. job-runner params.sendSuits bo'yicha ajratadi.
      params: { firmId, caseIds: sendIds, sendSuits: true, userId: input.userId },
    },
  });
  // POYGA: ikki operator bir vaqtda bosgan bo'lsa — kichik id yutadi, bizniki bekor.
  const rival = await prisma.job.findFirst({
    where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] }, id: { lt: job.id } },
    select: { id: true },
  });
  if (rival) {
    const c = await prisma.job.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'CANCELED', message: 'Bir vaqtda boshqa partiya yaratildi — bekor qilindi.' } });
    if (c.count > 0) {
      await releaseCourtSend(sendIds);
      return { ok: false, status: 409, error: t('Bir vaqtda boshqa partiya yaratildi — qaytadan urinib ko‘ring.') };
    }
  }
  enqueueJob(job.id);
  return { ok: true, jobId: job.id, total: sendIds.length, excluded };
}

// ── Jonli tekshiruv (portal) ──────────────────────────────────────────────────────────────────

const asArray = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data ?? []);
const normOrg = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

interface LiveRow { caseId: string; status: string; courtId: string | null; defName: string; claimants: string[] }

function parseListRow(c: any): LiveRow | null {
  const id = c?.case_id;
  if (!id) return null;
  const parts: any[] = Array.isArray(c?.participants) ? c.participants : [];
  return {
    caseId: String(id),
    status: String(c.current_status ?? c.status ?? '').toUpperCase(),
    courtId: c.court_id ? String(c.court_id) : null,
    defName: String(parts.find((p) => p?.type === 'DEFENDANT')?.name ?? ''),
    claimants: parts.filter((p) => p?.type === 'CLAIMANT').map((p) => String(p?.name ?? '')),
  };
}

/** Firma nomlari (status-ingest claimantIsFirm bilan bir xil yondashuv: FIRMS.name, zaxira shortName). */
function firmNameKeys(firm: { code: string; shortName: string }): string[] {
  const keys = [FIRMS.find((f) => f.branchCode === firm.code)?.name, firm.shortName].map(normOrg).filter((k) => k.length >= 4);
  return [...new Set(keys)];
}
function claimantMatches(claimants: string[], keys: string[]): boolean {
  return claimants.some((n) => keys.some((k) => normOrg(n).includes(k)));
}

interface DetailFacts { status: string | null; defendantPinfl: string | null; claimantTin: string | null }
function parseDetail(d: any): DetailFacts {
  const parts: any[] = Array.isArray(d?.participants) ? d.participants : [];
  const defs = parts.filter((p) => p?.participant?.type === 'DEFENDANT');
  // ASOSIY javobgar: is_main, yoki yagona javobgar. Bir nechta javobgar va hech biri main emas —
  // noaniq, PINFL tekshiruvidan o'tmaydi (taxmin qilib yubormaymiz).
  const main = defs.find((p) => p?.participant?.is_main === true) ?? (defs.length === 1 ? defs[0] : undefined);
  const cls = parts.filter((p) => p?.participant?.type === 'CLAIMANT');
  const cl = cls.find((p) => p?.participant?.is_main === true) ?? (cls.length === 1 ? cls[0] : undefined);
  return {
    status: d?.current_status ? String(d.current_status).toUpperCase() : null,
    defendantPinfl: main?.entity?.pinfl != null ? digits(main.entity.pinfl) : null,
    claimantTin: cl?.entity?.tin != null ? digits(cl.entity.tin) || null : null,
  };
}

function kindOf(e: unknown): string {
  if (e instanceof CabinetRequestError) return e.kind;
  const k = (e as { kind?: unknown } | null)?.kind;
  return typeof k === 'string' ? k : 'OTHER';
}
const isTransient = (k: string) => k === 'BLOCKED' || k === 'RATE_LIMIT' || k === 'SERVER';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

// ── Job (worker) ──────────────────────────────────────────────────────────────────────────────

export interface SendSuitsJobParams { firmId: number; caseIds: number[]; userId: number | null }

/**
 * Worker SIGTERM (deploy/restart) — partiya KEYINGI ish oldidan (PUT'dan oldin) to'xtaydi.
 * Busiz worker 90s kutib, ish o'rtasida o'ldirilardi va PUT paytidagi ish «tekshirish kerak»da
 * qolardi; ./scripts/update.sh har deploy'da shunday qiladi. Faqat worker chaqiradi (web emas).
 */
let shutdownRequested = false;
export function requestSendShutdown(): void { shutdownRequested = true; }

/**
 * Tanlangan suit'larni ketma-ket sudga topshiradi (bitta firma). Har ish orasida sudning
 * intervali (Court.sendIntervalSec, default 60s) — real rejim bilan bir xil tezlik.
 * Avto-davom YO'Q: to'xtasa operator qaytadan tanlab, qayta tasdiqlaydi.
 */
export async function runSendSuitsJob(jobId: number, params: SendSuitsJobParams): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });
  const caseIds = [...new Set(params.caseIds)];
  const total = caseIds.length;
  let sent = 0, failed = 0, check = 0, skipped = 0;
  let stopReason: string | null = null;
  let actor: { id?: number | null; username: string; role?: string | null } = SEND_ACTOR_FALLBACK;
  const progressMsg = () => {
    const parts = [`${sent}/${total} sudga yuborildi`];
    if (failed) parts.push(`${failed} xato`);
    if (check) parts.push(`${check} tekshirish kerak`);
    if (skipped) parts.push(`${skipped} o‘tkazildi`);
    return parts.join(' · ');
  };

  try {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { createdAt: true } });
    const firm = await prisma.firm.findUnique({ where: { id: params.firmId }, select: { id: true, shortName: true, code: true, stir: true, active: true } });
    if (!firm) throw new Error(`Firma topilmadi: id=${params.firmId}`);
    if (!firm.active) throw new Error(`${firm.shortName} nofaol — yuborilmaydi`);
    const stir = digits(firm.stir);
    if (!stir) throw new Error(`Firmada STIR yo'q: ${firm.shortName}`);
    if (params.userId) {
      const u = await prisma.admin.findUnique({ where: { id: params.userId }, select: { id: true, username: true, role: true } }).catch(() => null);
      if (u) actor = { id: u.id, username: u.username, role: u.role };
    }
    // ESKIRGAN PARTIYA: tasdiq bir necha daqiqa oldin berilgan; worker soatlab o'chib turgan bo'lsa
    // (deploy, disk to'lgan) partiya kechikib ketmasin — inson qarori o'sha paytdagi holatga edi.
    if (job && Date.now() - job.createdAt.getTime() > JOB_START_MAX_AGE_MS) {
      throw new Error('Partiya juda uzoq navbatda turdi — E-IMZO tasdig‘i eskirdi. Qaytadan tasdiqlab yuboring.');
    }
    if (process.env.CABINET_ALLOW_SEND_TO_COURT !== '1') throw new Error('Real yuborish serverda o‘chirilgan (CABINET_ALLOW_SEND_TO_COURT≠1)');

    // FAQAT FIRMANING O'Z SESSIYASI. court-submit-job'dagi `process.env.CABINET_TOKEN || sess.token`
    // bu yerda ATAYIN yo'q: env tokeni bilan hamma firmaning ishi bitta akkauntdan ketardi.
    const sess = await getStoredCabinetSession(stir);
    const client = new CabinetApiClient({ token: sess.token, account: stir, orgName: firm.shortName });
    const nameKeys = firmNameKeys(firm);

    await prisma.job.update({ where: { id: jobId }, data: { total, progress: 0, message: progressMsg() } }).catch(() => {});

    let live: LiveRow[] | null = null;
    let consecutive = 0;

    const preflight = async (): Promise<string | null> => {
      if (shutdownRequested) return 'Worker qayta ishga tushmoqda (deploy) — partiya to‘xtatildi, qolganini qaytadan tanlab yuboring';
      const j = await prisma.job.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
      if (j?.cancelRequested) return 'Operator bekor qildi';
      const p = await pauseStrict(firm.id);
      if (p.error) return `Pauza holatini o‘qib bo‘lmadi — xavfsizlik uchun to‘xtatildi (${p.error.slice(0, 120)})`;
      if (p.global || p.firm) return 'Pauza — operator jarayonni to‘xtatib qo‘ygan';
      if (process.env.CABINET_ALLOW_SEND_TO_COURT !== '1') return 'Real yuborish serverda o‘chirildi (CABINET_ALLOW_SEND_TO_COURT≠1)';
      return null;
    };
    const bumpProgress = async (idx: number) => {
      await prisma.job.update({ where: { id: jobId }, data: { progress: idx + 1, message: progressMsg() } }).catch(() => {});
    };
    const transientHit = async (kind: string): Promise<boolean> => {
      if (!isTransient(kind)) return false;
      consecutive++;
      if (consecutive >= MAX_CONSECUTIVE_BLOCKED) {
        backoff(15 * 60_000);
        await noteQueueBlocked().catch(() => null);
        stopReason = `Portal ketma-ket ${consecutive} marta javob bermadi (${kind}) — to‘xtatildi. Avtomat davom etmaydi: keyinroq qaytadan tanlab yuboring.`;
        return true;
      }
      backoff(30_000 * consecutive);
      return false;
    };

    for (let idx = 0; idx < caseIds.length; idx++) {
      const caseId = caseIds[idx];
      const stop1 = await preflight();
      if (stop1) { stopReason = stop1; break; }

      let ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: CASE_SELECT });
      if (!ac || ac.firmId !== firm.id) { skipped++; await bumpProgress(idx); continue; }

      // SUD OYNASI: partiya 100 ta × 60s = ~1.7 soat — cutoff (masalan 14:00) o'tib ketishi mumkin.
      // Oyna yopilsa ish URINILMAYDI (limiti oxirida qaytariladi), keyingi kun qayta tanlanadi.
      const win = ac.court ? courtWindow(ac.court) : null;
      if (win && !win.open) {
        skipped++;
        console.log(`[SendSuits ${jobId}] #${caseId}: sud oynasi yopiq (${win.reason}) — o'tkazildi`);
        await bumpProgress(idx);
        continue;
      }

      const gapMs = caseGapFor(ac.court?.sendIntervalSec);
      await paceCase(gapMs, (msLeft) => {
        const sec = Math.ceil(msLeft / 1000);
        void prisma.job.update({ where: { id: jobId }, data: { message: `${progressMsg()} — keyingisi ${sec}s dan keyin` } }).catch(() => {});
      });
      // Kutish davomida pauza/bekor bosilgan bo'lishi mumkin — yana tekshiramiz.
      const stop2 = await preflight();
      if (stop2) { stopReason = stop2; break; }

      // DB QAYTA TEKSHIRUV (yaratilgandan beri holat o'zgargan bo'lishi mumkin).
      ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: CASE_SELECT });
      if (!ac) { skipped++; await bumpProgress(idx); continue; }
      const ev = evaluate(ac, await loadEligCtx([ac]));
      if (ev.blockers.length) {
        skipped++;
        console.log(`[SendSuits ${jobId}] #${caseId}: DB tekshiruvidan o'tmadi (${ev.blockers.join(', ')}) — o'tkazildi`);
        await bumpProgress(idx);
        continue;
      }
      const m = metaObj(ac.meta);
      const cabId = String(m.cabinetCaseId);

      // JONLI RO'YXAT — partiyada BIR MARTA (fuqarolik all-cases, status-ingest bilan bir manba).
      if (!live) {
        try {
          const r = await client.get<any>('/api/cabinet/case/civil/all-cases', { timeoutMs: 60_000 });
          live = asArray(r.data).map(parseListRow).filter((x): x is LiveRow => !!x);
          consecutive = 0;
        } catch (e) {
          const k = kindOf(e);
          stopReason = k === 'AUTH'
            ? 'Cabinet sessiyasi tugagan — E-IMZO bilan qayta imzolang, so‘ng qaytadan yuboring'
            : `Portal ro‘yxati olinmadi (${k}: ${errMsg(e).slice(0, 160)}) — hech narsa yuborilmadi`;
          if (isTransient(k)) backoff(60_000);
          break;
        }
      }

      const markFailed = async (msg: string, kind = 'TEKSHIRUV') => {
        failed++;
        await writeCourtSend(caseId, { state: 'FAILED', at: new Date().toISOString(), cabinetCaseId: cabId, jobId, userId: params.userId, error: msg.slice(0, 500) });
        await releaseCourtSend([caseId]);
        await audit(AuditAction.COURT_SUBMIT, {
          actor, target: `case:${caseId}`,
          detail: { natija: 'SUDGA O‘TKAZILMADI', turi: kind, firma: firm.shortName, mijoz: ac!.clientName, pinfl: ac!.pinfl, ish: cabId, xato: msg.slice(0, 500), jobId },
        });
      };

      // 1) Ro'yxatdagi qator: CREATED, sud mos, shu javobgarga shu da'vogardan boshqa ochiq/CREATED ish yo'q.
      //    Da'vogar qarori detalda (STIR) — ro'yxatda faqat nom bor va u FIRMS.name imlosidan farq qilishi mumkin.
      const row = live.find((r) => r.caseId === cabId);
      if (!row) { await markFailed(`Portal ro‘yxatida bu ish (${cabId}) topilmadi — sessiya boshqa firmaniki yoki suit o‘chirilgan.`); await bumpProgress(idx); continue; }
      if (row.status !== 'CREATED') { await markFailed(`Portalda holati ${row.status || 'noma’lum'} — CREATED emas (allaqachon yuborilgan yoki qaytgan).`); await bumpProgress(idx); continue; }
      const listClaimOk: boolean | null = row.claimants.length ? claimantMatches(row.claimants, nameKeys) : null;
      let wantCourt: string | null = null;
      try { wantCourt = resolveCabinetCourtGuid(ac.court); } catch (e) { await markFailed(`Sud aniqlanmadi: ${errMsg(e)}`); await bumpProgress(idx); continue; }
      if (row.courtId && wantCourt && row.courtId !== wantCourt) {
        await markFailed(`Suit portalda boshqa sudga yozilgan (${row.courtId}) — bazadagi sud (${ac.court?.shortName ?? '?'}) bilan mos emas.`); await bumpProgress(idx); continue;
      }
      // AKA-UKA ISH: shu javobgar (portal imlosi YOKI bizdagi ism) + SHU da'vogar. Da'vogar
      // tengligi maqsad qatorning O'Z da'vogar nomi bilan ham solishtiriladi — FIRMS.name imlosi
      // portalnikidan farq qilsa ham shu firmaning boshqa ishi «begona» deb o'tkazib yuborilmasin
      // (xavfli tomon). Da'vogari yo'q qator ham shu firmaniki deb olinadi (ehtiyot).
      const defKeys = new Set([normName(row.defName), normName(ac.clientName ?? '')].filter(Boolean));
      const ownClaimNorms = new Set(row.claimants.map(normOrg).filter(Boolean));
      const sameClaimant = (r: LiveRow) => !r.claimants.length
        || r.claimants.some((n) => ownClaimNorms.has(normOrg(n)))
        || claimantMatches(r.claimants, nameKeys);
      const sibling = live.find((r) => r.caseId !== cabId
        && SIBLING_BLOCK_STATUSES.has(r.status)
        && defKeys.has(normName(r.defName))
        && sameClaimant(r));
      if (sibling) {
        await markFailed(`Shu javobgarga portalda boshqa ish bor (${sibling.caseId}, ${sibling.status}) — ikkinchi da‘vo xavfi. Avval dublikatni portalda hal qiling.`);
        await bumpProgress(idx);
        continue;
      }

      // 2) Detal: javobgar PINFL + da'vogar STIR + holat (ro'yxat ~bir necha daqiqa eski bo'lishi mumkin).
      let facts: DetailFacts;
      try {
        const d = await client.get<any>(`/api/cabinet/case/get-one-case-by-id/${encodeURIComponent(cabId)}`, { timeoutMs: 45_000 });
        facts = parseDetail(d.data);
        consecutive = 0;
      } catch (e) {
        const k = kindOf(e);
        if (k === 'AUTH') { stopReason = 'Cabinet sessiyasi tugagan — E-IMZO bilan qayta imzolang, so‘ng qaytadan yuboring'; break; }
        await markFailed(`Portal detalini o‘qib bo‘lmadi (${k}: ${errMsg(e).slice(0, 160)}) — yuborilmadi, qayta urinib ko‘ring.`, k);
        await bumpProgress(idx);
        if (await transientHit(k)) break;
        continue;
      }
      if (!ac.pinfl || !facts.defendantPinfl || facts.defendantPinfl !== digits(ac.pinfl)) {
        await markFailed(`Portaldagi javobgar PINFL (${facts.defendantPinfl ?? 'yo‘q'}) bizdagi (${ac.pinfl ?? 'yo‘q'}) bilan mos emas — boshqa odam.`);
        await bumpProgress(idx);
        continue;
      }
      // DA'VOGAR: detaldagi asosiy da'vogar STIR'i (namunada entity.tin = firma STIR) — HAL QILUVCHI.
      // U yo'q bo'lsagina ro'yxatdagi nom (status-ingest claimantIsFirm yondashuvi) — u ham yo'q yoki
      // mos kelmasa, yubormaymiz (qaytarib bo'lmaydigan amalda taxmin yo'q).
      const claimOk = facts.claimantTin ? facts.claimantTin === stir : listClaimOk === true;
      if (!claimOk) {
        await markFailed(facts.claimantTin
          ? `Portaldagi da‘vogar STIR ${facts.claimantTin} ≠ ${firm.shortName} (${stir}).`
          : row.claimants.length
            ? `Portaldagi da‘vogar «${row.claimants[0].slice(0, 80)}» — ${firm.shortName} ekanini tasdiqlab bo‘lmadi.`
            : 'Da‘vogar portalda aniqlanmadi — yuborilmadi.');
        await bumpProgress(idx);
        continue;
      }
      if (facts.status && facts.status !== 'CREATED') {
        await markFailed(`Portalda holati ${facts.status} — CREATED emas.`);
        await bumpProgress(idx);
        continue;
      }

      // 3) PUT'dan oldin OXIRGI tekshiruv (ro'yxat/detal bir necha soniya oldi).
      const stop3 = await preflight();
      if (stop3) { stopReason = stop3; break; }

      // 4) ATOMAR BAND QILISH: SENDING. Boshqa jarayon (yoki ikkinchi job) shu ishni olgan bo'lsa — 0 qator.
      const claimed = await claimSending(caseId, cabId, jobId, params.userId);
      if (!claimed) {
        skipped++;
        console.log(`[SendSuits ${jobId}] #${caseId}: SENDING band qilinmadi (holat o'zgargan) — o'tkazildi`);
        await bumpProgress(idx);
        continue;
      }

      // 5) YAKUNIY, QAYTMAS QADAM.
      console.log(`[SendSuits ${jobId}] [${idx + 1}/${total}] #${caseId} (${ac.clientName}) → send-to-court ${cabId}`);
      try {
        const r = await client.put<any>(`${CABINET_ENDPOINTS.sendToCourt}${encodeURIComponent(cabId)}`, {}, { timeoutMs: 60_000 });
        consecutive = 0;
        // Bazaga yozilmasa SENDING qoladi → yakunda CHECK (settleUnsent sanaydi) — bu yerda sanalmaydi.
        if (await markSent(ac, cabId, jobId, params.userId, r.data, actor, firm.shortName, 'javob OK')) sent++;
      } catch (e) {
        const k = kindOf(e);
        const msg = errMsg(e);
        if (k === 'BAD_REQUEST' || k === 'AUTH') {
          // ANIQ RAD (4xx): portal so'rovni qabul qilmadi — yuborilmagan.
          await markFailed(`Portal rad etdi: ${msg}`, k);
          if (k === 'AUTH') { stopReason = 'Cabinet sessiyasi tugagan — E-IMZO bilan qayta imzolang, so‘ng qaytadan yuboring'; await bumpProgress(idx); break; }
        } else {
          // NOANIQ (timeout / 5xx / tarmoq / 429): PUT portalga yetib, bajarilgan bo'lishi mumkin.
          // Holatni qayta o'qiymiz — FAILED deb yozib qayta yuborishdan oldin haqiqatni bilish shart.
          await sleep(5_000);
          let st: string | null = null;
          try {
            const d2 = await client.get<any>(`/api/cabinet/case/get-one-case-by-id/${encodeURIComponent(cabId)}`, { timeoutMs: 45_000 });
            st = parseDetail(d2.data).status;
          } catch { st = null; }
          if (st && st !== 'CREATED' && st !== 'DRAFT') {
            if (await markSent(ac, cabId, jobId, params.userId, null, actor, firm.shortName, `noaniq javobdan keyin tasdiqlandi (${k}, holat ${st})`)) sent++;
          } else if (st === 'CREATED' || st === 'DRAFT') {
            await markFailed(`Noaniq javob (${k}: ${msg.slice(0, 160)}); portalda hali ${st} — yuborilmagan, qayta urinish mumkin.`, k);
          } else {
            check++;
            await writeCourtSend(caseId, {
              state: 'CHECK', at: new Date().toISOString(), cabinetCaseId: cabId, jobId, userId: params.userId,
              error: `Noaniq javob (${k}: ${msg.slice(0, 160)}) va holat o‘qilmadi — portalda qo‘lda tekshiring.`,
            });
            await audit(AuditAction.COURT_SUBMIT, {
              actor, target: `case:${caseId}`,
              detail: { natija: 'TEKSHIRISH KERAK', turi: k, firma: firm.shortName, mijoz: ac.clientName, pinfl: ac.pinfl, ish: cabId, xato: msg, jobId },
            });
          }
          if (await transientHit(k)) { await bumpProgress(idx); break; }
        }
      }
      await bumpProgress(idx);
    }
  } catch (fatal) {
    stopReason = errMsg(fatal);
    console.error(`❌ [SendSuits ${jobId}] Bosh xatolik:`, stopReason);
  }

  // YAKUN: SENDING qolgan (kutilmagan istisno PUT atrofida) → CHECK; yuborilmaganlarning limiti qaytadi.
  const fin = await settleUnsent(caseIds, jobId).catch((e) => { console.error(`[SendSuits ${jobId}] yakuniy tozalash xatosi`, e); return { released: 0, toCheck: 0 }; });
  check += fin.toCheck;
  const message = `${progressMsg()}${stopReason ? ` — ${stopReason}` : ''}`;
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: sent === 0 && (failed + check > 0 || !!stopReason) ? 'FAILED' : 'DONE',
      progress: total,
      message,
    },
  }).catch(() => {});
  await audit(AuditAction.COURT_SUBMIT, {
    actor, target: `firm:${params.firmId}`,
    detail: { natija: 'sudga o‘tkazish partiyasi yakunlandi', jobId, jami: total, yuborildi: sent, xato: failed, tekshirishKerak: check, otkazildi: skipped, limitQaytdi: fin.released, toxtashSababi: stopReason },
  });
  console.log(`[SendSuits ${jobId}] Yakun: ${message}`);
}

/** meta.courtSend'ni yangilaydi (qolgan meta saqlanadi). */
async function writeCourtSend(caseId: number, cs: CourtSendMeta): Promise<void> {
  const cur = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { meta: true } });
  const m = metaObj(cur?.meta);
  await prisma.arizaCase.update({ where: { id: caseId }, data: { meta: { ...m, courtSend: cs } as unknown as Prisma.InputJsonValue } });
}

/**
 * SENDING'ni ATOMAR yozadi — faqat ish hali yuborilmagan va boshqa jarayon band qilmagan bo'lsa.
 * Prisma JSON maydonida shartli yangilash bera olmaydi, shuning uchun bitta UPDATE ... WHERE
 * (MySQL qatorni qulflaydi — ikki jarayondan faqat bittasi 1 qator oladi).
 */
async function claimSending(caseId: number, cabId: string, jobId: number, userId: number | null): Promise<boolean> {
  const cs = JSON.stringify({ state: 'SENDING', at: new Date().toISOString(), cabinetCaseId: cabId, jobId, userId } satisfies CourtSendMeta);
  // Shartlar: ish hali yuborilmagan; suit tekshiruvdan beri almashmagan (cabinetCaseId o'sha);
  // SHU suit uchun SENDING/CHECK/SENT yo'q (boshqa, eski suit'niki hisobga olinmaydi — courtSendOf bilan bir qoida).
  const n = await prisma.$executeRaw`
    UPDATE ArizaCase
    SET meta = JSON_SET(COALESCE(meta, JSON_OBJECT()), '$.courtSend', CAST(${cs} AS JSON)), updatedAt = NOW(3)
    WHERE id = ${caseId}
      AND courtCaseId IS NULL
      AND stage NOT IN ('COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED')
      AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.cabinetCaseId')) = ${cabId}
      AND NOT (
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(meta, '$.courtSend.state')), '') IN ('SENDING', 'CHECK', 'SENT')
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(meta, '$.courtSend.cabinetCaseId')), ${cabId}) = ${cabId}
      )
  `;
  return n > 0;
}

/** MUVAFFAQIYAT — real rejim yozadigan maydonlar (outcome-sync / flagsFor / qaytganlar shundan davom etadi). */
async function markSent(
  ac: CaseRow, cabId: string, jobId: number, userId: number | null, resp: any,
  actor: { id?: number | null; username: string; role?: string | null }, firmName: string, how: string,
): Promise<boolean> {
  const now = new Date();
  try {
    const cur = await prisma.arizaCase.findUnique({ where: { id: ac.id }, select: { meta: true } });
    const m = metaObj(cur?.meta);
    const caseNumber = resp?.case_number ?? resp?.caseNumber ?? null;
    const registryNumber = resp?.registry_number ?? resp?.registryNumber ?? null;
    await prisma.arizaCase.update({
      where: { id: ac.id },
      data: {
        stage: 'COURT_SUBMITTED',
        stageEnteredAt: now,
        courtSentAt: now,
        // courtCaseId = portal case_id (outcome-sync idsOf(case_id) bilan mos keladi).
        courtCaseId: cabId,
        meta: {
          ...m,
          // suitReadyAt / cabinetDraftId ATAYIN saqlanadi (tarix + qaytganlar oqimi).
          cabinetSubmittedAt: now.toISOString(),
          ...(caseNumber ? { caseNumber } : {}),
          ...(registryNumber ? { registryNumber } : {}),
          courtSend: { state: 'SENT', at: now.toISOString(), cabinetCaseId: cabId, jobId, userId } satisfies CourtSendMeta,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    // PUT o'tgan, lekin bazaga yozilmadi — SENDING qoladi; settleUnsent/restart uni CHECK qiladi.
    console.error(`⚠ [SendSuits ${jobId}] #${ac.id} SUDGA KETDI, lekin bazaga yozilmadi:`, errMsg(e));
    return false;
  }
  // Sud ADOLAT'da ochiq ekani jonli traffikdan tasdiqlandi (court-submit-job syncCourtCabinetState(ok) bilan bir xil).
  if (ac.courtId) {
    await prisma.court.updateMany({ where: { id: ac.courtId, cabinetEnabled: false }, data: { cabinetEnabled: true, cabinetNote: null } }).catch(() => {});
  }
  void resetQueueBackoff().catch(() => {});
  await audit(AuditAction.COURT_SUBMIT, {
    actor, target: `case:${ac.id}`,
    detail: {
      natija: 'SUDGA YUBORILDI', usul: 'sudga o‘tkazish (saqlangan suit)', izoh: how, firma: firmName,
      mijoz: ac.clientName, pinfl: ac.pinfl, sud: ac.court?.shortName ?? null, summa: String(ac.totalDebt), ish: cabId, jobId,
    },
  });
  console.log(`✔ [SendSuits ${jobId}] #${ac.id} SUDGA YUBORILDI (${cabId}) — ${how}`);
  return true;
}

/**
 * Partiya oxirida (yoki restart'da): shu job'ning SENDING'da qolgan ishlari → CHECK (natija
 * noma'lum — limit BO'SHATILMAYDI); yuborilmagan va CHECK bo'lmaganlarning kunlik limiti qaytadi.
 */
async function settleUnsent(caseIds: number[], jobId: number): Promise<{ released: number; toCheck: number }> {
  if (!caseIds.length) return { released: 0, toCheck: 0 };
  const rows = await prisma.arizaCase.findMany({
    where: { id: { in: caseIds } },
    select: { id: true, meta: true, courtCaseId: true, stage: true, courtSentAt: true },
  });
  let toCheck = 0;
  const release: number[] = [];
  for (const r of rows) {
    const cs = courtSendOf(metaObj(r.meta));
    const isSent = !!r.courtCaseId || SENT_STAGES.has(r.stage);
    if (cs?.state === 'SENDING' && !isSent) {
      if (cs.jobId == null || Number(cs.jobId) === jobId) {
        toCheck++;
        await writeCourtSend(r.id, {
          state: 'CHECK', at: new Date().toISOString(), cabinetCaseId: cs.cabinetCaseId, jobId, userId: cs.userId ?? null,
          error: 'Yuborish paytida jarayon uzildi — natija noma’lum. Portalda holatini qo‘lda tekshiring.',
        });
      }
      continue;
    }
    if (isSent || cs?.state === 'CHECK') continue;
    if (r.courtSentAt) release.push(r.id);
  }
  if (release.length) await releaseCourtSend(release);
  return { released: release.length, toCheck };
}

/**
 * Hali BOSHLANMAGAN (PENDING) sudga-o'tkazish partiyasi bekor qilindi (/api/jobs/:id POST): job hech
 * qachon ishlamaydi, shuning uchun uning settleUnsent'i ham ishlamasdi va createSendSuitsJob band qilgan
 * sud kunlik limiti yarim tungacha band qolardi (2026-09-19 kod ko'rigi). Bu yerda qaytariladi.
 * sendSuits bo'lmagan job — hech narsa qilinmaydi.
 */
export async function releaseCanceledSendJob(jobId: number): Promise<number> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { type: true, status: true, params: true } });
  const p = (job?.params ?? {}) as Record<string, unknown>;
  if (!job || job.type !== 'COURT_SUBMIT' || p.sendSuits !== true || job.status !== 'CANCELED') return 0;
  const ids = Array.isArray(p.caseIds) ? p.caseIds.map(Number).filter((x) => Number.isInteger(x) && x > 0) : [];
  const r = await settleUnsent(ids, jobId);
  return r.released;
}

/**
 * Worker restart: uzilgan sudga-o'tkazish partiyasi. Avto-davom YO'Q (inson tasdig'i shu partiya
 * uchun edi) — job FAILED, SENDING'dagi ish CHECK (PUT ketgan-ketmagani noma'lum, limit saqlanadi),
 * urinilmaganlarining limiti qaytadi. Yuborilganlarga (courtCaseId) TEGILMAYDI.
 */
export async function recoverInterruptedSendJob(jobId: number): Promise<{ check: number; released: number }> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { params: true, progress: true, total: true } });
  if (!job) return { check: 0, released: 0 };
  const p = (job.params ?? {}) as { caseIds?: unknown };
  const caseIds = (Array.isArray(p.caseIds) ? p.caseIds : []).map(Number).filter((x) => Number.isInteger(x) && x > 0);
  const res = await settleUnsent(caseIds, jobId);
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'FAILED',
      message: `Uzilib qoldi (${job.progress}/${job.total}) — worker qayta ishga tushdi. Yuborilganlar saqlandi`
        + `${res.toCheck ? `; ${res.toCheck} ta ish «tekshirish kerak» (portalda qo‘lda tekshiring)` : ''}. `
        + 'Avtomat davom etmaydi — qolganini qaytadan tanlab, E-IMZO bilan tasdiqlab yuboring.',
    },
  });
  return { check: res.toCheck, released: res.released };
}

/**
 * Startda: hech bir job'ga tegishli bo'lmagan SENDING (job allaqachon yopilgan, lekin yakuniy
 * yozuv yiqilgan) → CHECK. Worker yagona nusxa bo'lgani uchun startda hech bir ish haqiqatan
 * «yuborilayotgan» bo'lishi mumkin emas — resetInterruptedCourtJobs dan KEYIN chaqiriladi.
 */
export async function sweepOrphanSending(): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM ArizaCase WHERE JSON_UNQUOTE(JSON_EXTRACT(meta, '$.courtSend.state')) = 'SENDING'
  `;
  if (!rows.length) return 0;
  const running = await prisma.job.findMany({ where: { type: 'COURT_SUBMIT', status: 'RUNNING' }, select: { id: true } });
  const live = new Set(running.map((j) => j.id));
  let n = 0;
  for (const r of rows) {
    const id = Number(r.id);
    const cur = await prisma.arizaCase.findUnique({ where: { id }, select: { meta: true, courtCaseId: true, stage: true } });
    const cs = courtSendOf(metaObj(cur?.meta));
    if (!cur || cs?.state !== 'SENDING') continue;
    if (cs.jobId != null && live.has(Number(cs.jobId))) continue;
    if (cur.courtCaseId || SENT_STAGES.has(cur.stage)) continue;
    await writeCourtSend(id, {
      state: 'CHECK', at: new Date().toISOString(), cabinetCaseId: cs.cabinetCaseId, jobId: cs.jobId, userId: cs.userId ?? null,
      error: 'Yuborish paytida jarayon uzildi — natija noma’lum. Portalda holatini qo‘lda tekshiring.',
    });
    n++;
  }
  return n;
}

/** CHECK/SENDING'dagi ishlar — worker limit-tozalashi ularning courtSentAt'iga tegmasin. */
export function isSendInFlight(meta: unknown): boolean {
  const cs = courtSendOf(metaObj(meta));
  return cs?.state === 'SENDING' || cs?.state === 'CHECK';
}
