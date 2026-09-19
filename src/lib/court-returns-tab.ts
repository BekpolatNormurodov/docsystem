// /sud → «Qaytganlar» tab'i (2026-09-19 qayta dizayn): sud QAYTARGAN ishlarni BIZNING ish
// (ArizaCase) bo'yicha ko'rsatadi va ular ustida amal qilish imkonini beradi.
//
// NEGA YANGI MODUL: ilgari «qaytgan» degan narsa ikki joyda, bir-biriga bog'lanmagan holda turardi:
//   • /sud/qaytganlar (court-returns.ts) — faqat portal (ClientCaseStatus) yozuvlari; ArizaCase
//     id'si yo'q, shuning uchun hech qanday amal (ushlab turish, qayta qoralama) biriktirib bo'lmasdi;
//     status-darajali DECLINED (caseResult bo'sh — reyestrda qaytarilganlar, eng katta guruh) umuman
//     chiqmasdi;
//   • courtReturns() (court-ready.ts) — stage bo'yicha, lekin portal natijasi, sabab, qaytgan sana,
//     ushlab turish belgisi yo'q; UI'si esa o'lik kod edi.
// Bu modul ikkalasini birlashtiradi: manba — ArizaCase (stage COURT_RETURNED YOKI meta.declinedAt),
// portal qatori meta.declinedCaseId orqali ulanadi (topilmasa PINFL + firma kodi bo'yicha qaytgan
// yozuv), tayyorlik — AYNI flagsFor (readinessByCaseIds), sabab — conflict-suit-view.decline_reasons
// (bir marta olinadi va meta.declineReasons'da saqlanadi).
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { konveyerSnapshots } from './konveyer';
import { readinessByCaseIds, SENT_STAGES, FIRM_REQUIRED_DOCS, FIRM_DOC_LABEL, MAX_COURT_BATCH, type CaseReadiness } from './court-ready';
import { COURT_RESULT_UZ, COURT_STATUS_UZ } from './court-result';
import { allocateFirmCases, consumeCourtSend } from './court-routing';
import { enqueueJob } from './job-dispatch';
import { isFirmPaused, paceRequest } from './cabinet/pacer';
import { getStoredCabinetSession } from './cabinet/session';
import { getSuit } from './cabinet/api';
import { SessionExpiredError } from './session-store';
import { audit, AuditAction } from './audit';

export type ReturnSub = 'waiting' | 'held' | 'queued' | 'failed' | 'redrafted';
export type ReasonCode = 'tartibsiz' | 'varaq' | 'yetkazilmagan' | 'jshshir' | 'boshqa';
export const RETURN_SUBS: ReturnSub[] = ['waiting', 'failed', 'held', 'queued', 'redrafted'];
export const REASON_CODES: ReasonCode[] = ['tartibsiz', 'varaq', 'yetkazilmagan', 'jshshir', 'boshqa'];

export interface ReturnRow {
  caseId: number;
  firmId: number;
  firmName: string;
  clientName: string | null;
  pinfl: string | null;
  courtName: string | null;
  declinedAt: string | null;
  declinedCaseId: string | null;
  portalResult: string | null;
  portalResultLabel: string | null;
  reasons: string[];
  reasonCode: ReasonCode | null;
  sub: ReturnSub;
  queueError: string | null;
  ready: boolean;
  missing: string[];
  totalDebt: number | null;
  // ── Qo'shimcha (kontraktdan tashqari, faqat ReturnsTab ishlatadi) ──
  /** CaseDocs modali uchun. */
  stage: string;
  receiptNumber: string | null;
  talabnomaSent: boolean;
  flags: CaseReadiness['flags'] | null;
  /** flagsFor().sendable — qayta qoralamaga olinadimi (5 gate + navbatda/ushlab turilgan EMAS). */
  sendable: boolean;
  /** Portal qatori (ajrim shu raqam bo'yicha ochiladi; reyestrda qaytarilganlarda ajrim yo'q). */
  portalCaseNumber: string | null;
  portalStatus: string | null;
  /** Sabab olingan vaqt (null — hali olinmagan). */
  reasonsAt: string | null;
  /** Portalda SHU odamga shu firma nomidan BOSHQA ochiq ish bor (odatda eski CREATED suit) —
   *  qayta qoralama IKKINCHI da'vo ochadi, shuning uchun bunday ish qayta qoralamaga olinmaydi. */
  dupOpen: boolean;
  heldAt: string | null;
  redraftedAt: string | null;
}

export interface ReturnsTabData {
  rows: ReturnRow[];
  counts: { total: number; bySub: Record<ReturnSub, number>; byReason: Record<string, number> };
  /** Setting court_declined_reset === '1' — worker portal qaytarganlarni o'zi shu ro'yxatga o'tkazadimi. */
  autoReset: boolean;
  snapshotId: number | null;
  /** Ayni paytdagi COURT_SUBMIT partiyasi (bir vaqtda bitta) — UI tugmani o'chirib, holatni yangilab turadi. */
  activeJob: { id: number; firmId: number | null; kind: 'send' | 'draft' | 'real'; progress: number; total: number; fromReturns: boolean } | null;
}

async function activeCourtJob(): Promise<ReturnsTabData['activeJob']> {
  const j = await prisma.job.findFirst({
    where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } },
    orderBy: { id: 'desc' },
    select: { id: true, progress: true, total: true, params: true },
  }).catch(() => null);
  if (!j) return null;
  const p = (j.params ?? {}) as { firmId?: unknown; suitMode?: unknown; draftMode?: unknown; sendSuits?: unknown; source?: unknown };
  const kind = p.sendSuits === true ? 'send' : p.suitMode === true || p.draftMode === true ? 'draft' : 'real';
  return { id: j.id, firmId: Number(p.firmId) || null, kind, progress: j.progress ?? 0, total: j.total ?? 0, fromReturns: p.source === 'sud-returns' };
}

type Meta = Record<string, unknown>;
const metaObj = (meta: unknown): Meta =>
  meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...(meta as Meta) } : {};
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const ms = (v: unknown): number | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};
const digits = (s: string | null | undefined) => (s || '').replace(/\D/g, '');

// Portal «qayta yuborish» asosi (outcome-sync isResendRow bilan bir xil ta'rif): status DECLINED
// (WITHDRAWN emas) yoki natija RETURNED/REFUSED/UNCONSIDERED.
const RESEND_RESULTS = new Set(['RETURNED', 'REFUSED', 'UNCONSIDERED']);
const isResendRow = (r: { status: string | null; caseResult: string | null }) =>
  r.status === 'DECLINED' ? r.caseResult !== 'WITHDRAWN' : (!!r.caseResult && RESEND_RESULTS.has(r.caseResult));
// Portalda AYNI PAYTDA ochiq ish holatlari (court-ready OPEN_PORTAL_STATUSES bilan bir xil).
const OPEN_PORTAL = new Set(['ALLOCATE', 'CREATED', 'REGISTER', 'PENDING', 'IN_PROCESS']);
// outcome-sync qaytishni aniqlaganda navbat yozuviga yozadigan UMUMIY matn — bu «qayta qoralama
// xatosi» EMAS, shuning uchun `failed` holatiga sanalmaydi (aks holda deyarli hamma qaytgan ish
// «Xato» bo'lib ko'rinardi).
const DECLINE_MARK = /^Sud rad etdi/;
const HOLD_MARK = /ushlab turilibdi/i;

/** Sabab matnlaridan bitta kod — chip/filtr uchun. Tartib muhim: eng ko'p uchraydigani birinchi. */
export function declineReasonCode(reasons: string[]): ReasonCode | null {
  if (!reasons.length) return null;
  const all = reasons.join(' \n ').toLowerCase();
  if (/тартибсиз|тескари|tartibsiz|teskari/.test(all)) return 'tartibsiz';
  if (/варақ|varaq/.test(all)) return 'varaq';
  if (/огоҳлантириш|олганлиги|етказил|ogohlantirish|olganligi|yetkazil/.test(all)) return 'yetkazilmagan';
  if (/жшшир|jshshir|пинфл|pinfl/.test(all)) return 'jshshir';
  return 'boshqa';
}

async function resolveSnapshot(snapshotId?: number): Promise<number | undefined> {
  const snaps = await konveyerSnapshots();
  if (snapshotId && snaps.some((s) => s.id === snapshotId)) return snapshotId;
  return snaps[0]?.id;
}

type PortalRow = { branchCode: string; pinfl: string | null; caseNumber: string | null; claimId: string | null; status: string; caseResult: string | null; statusLabel: string | null; updatedAt: Date; detail?: unknown };

/** «Qaytganlar» tab'i ma'lumoti. Faqat DB o'qiydi (portalga so'rov yo'q). */
export async function returnedCasesForTab(opts: { snapshotId?: number; firmId?: number }): Promise<ReturnsTabData> {
  const snapshotId = await resolveSnapshot(opts.snapshotId);
  const emptyBySub = (): Record<ReturnSub, number> => ({ waiting: 0, held: 0, queued: 0, failed: 0, redrafted: 0 });
  const [autoRow, activeJob] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'court_declined_reset' }, select: { value: true } }).catch(() => null),
    activeCourtJob(),
  ]);
  const autoReset = autoRow?.value === '1';
  if (!snapshotId) return { rows: [], counts: { total: 0, bySub: emptyBySub(), byReason: {} }, autoReset, snapshotId: null, activeJob };

  const cases = await prisma.arizaCase.findMany({
    where: {
      snapshotId,
      ...(opts.firmId ? { firmId: opts.firmId } : {}),
      firm: { active: true }, // nofaol firma patoki hech qayerda ko'rinmaydi (memory: firm-active-inactive)
      // Sudga qayta ketgan (yoki yopilgan) ish endi «qaytgan» emas — declinedAt meta'da abadiy
      // qoladi, shuning uchun uni bosqich bilan kesamiz.
      stage: { notIn: [...SENT_STAGES] },
      OR: [
        { stage: 'COURT_RETURNED' },
        // ISO sana '2…' bilan boshlanadi — JSON yo'l filtri (butun snapshotni JS'da skanerlamaslik uchun).
        { meta: { path: '$.declinedAt', string_starts_with: '2' } },
      ],
    },
    select: {
      id: true, firmId: true, pinfl: true, clientName: true, stage: true, stageEnteredAt: true,
      receiptNumber: true, talabnomaAt: true, totalDebt: true, meta: true, dueAt: true,
      court: { select: { shortName: true } },
      firm: { select: { shortName: true, code: true } },
    },
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
  });
  if (!cases.length) return { rows: [], counts: { total: 0, bySub: emptyBySub(), byReason: {} }, autoReset, snapshotId, activeJob };

  const ids = cases.map((c) => c.id);
  const metas = new Map(cases.map((c) => [c.id, metaObj(c.meta)]));
  const declinedIds = [...new Set(cases.map((c) => str(metas.get(c.id)!.declinedCaseId)).filter((x): x is string => !!x))];
  const pinfls = [...new Set(cases.map((c) => c.pinfl).filter((x): x is string => !!x))];
  const portalSel = { branchCode: true, pinfl: true, caseNumber: true, claimId: true, status: true, caseResult: true, statusLabel: true, updatedAt: true } as const;

  const firmIds = [...new Set(cases.map((c) => c.firmId))];
  const [queue, byIdRows, byPinflRows, readinessList] = await Promise.all([
    prisma.courtQueueItem.findMany({
      where: { caseId: { in: ids } },
      select: { caseId: true, state: true, lastError: true, updatedAt: true, finishedAt: true },
    }),
    declinedIds.length
      ? prisma.clientCaseStatus.findMany({ where: { source: 'CABINET', OR: [{ caseNumber: { in: declinedIds } }, { claimId: { in: declinedIds } }] }, select: portalSel })
      : Promise.resolve([] as PortalRow[]),
    pinfls.length
      ? prisma.clientCaseStatus.findMany({ where: { source: 'CABINET', pinfl: { in: pinfls } }, select: portalSel })
      : Promise.resolve([] as PortalRow[]),
    Promise.all(firmIds.map((fid) => readinessByCaseIds(fid, cases.filter((c) => c.firmId === fid).map((c) => c.id)))),
  ]);
  const qByCase = new Map(queue.map((q) => [q.caseId, q]));
  const readiness = new Map<number, CaseReadiness>();
  for (const m of readinessList) for (const [k, v] of m) readiness.set(k, v);
  const byPortalId = new Map<string, PortalRow[]>();
  for (const r of byIdRows) {
    for (const k of [r.caseNumber, r.claimId]) {
      if (!k) continue;
      const l = byPortalId.get(k) ?? [];
      l.push(r);
      byPortalId.set(k, l);
    }
  }
  const byPinfl = new Map<string, PortalRow[]>();
  for (const r of byPinflRows) {
    if (!r.pinfl) continue;
    const l = byPinfl.get(r.pinfl) ?? [];
    l.push(r);
    byPinfl.set(r.pinfl, l);
  }
  const newest = (l: PortalRow[]) => l.reduce<PortalRow | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null);

  const rows: ReturnRow[] = [];
  for (const c of cases) {
    const m = metas.get(c.id)!;
    const rd = readiness.get(c.id);
    const q = qByCase.get(c.id);
    const declinedCaseId = str(m.declinedCaseId);
    const cabinetCaseId = str(m.cabinetCaseId);
    // Qaytgan sana: meta.declinedAt (biz aniqlagan payt); yo'q bo'lsa (qo'lda SQL bilan
    // qaytarilganlar) — bosqichga kirgan vaqt.
    const declinedMs = ms(m.declinedAt) ?? (c.stage === 'COURT_RETURNED' && c.stageEnteredAt ? c.stageEnteredAt.getTime() : null);
    const readyAtMs = ms(m.suitReadyAt) ?? ms(m.draftReadyAt);
    const held = m.resendHold != null && m.resendHold !== false;
    const queued = q?.state === 'PENDING' || q?.state === 'RUNNING';
    const redrafted = readyAtMs != null && (declinedMs == null || readyAtMs > declinedMs);
    const qAt = q ? (q.finishedAt ?? q.updatedAt).getTime() : 0;
    const failed = !!q && (q.state === 'FAILED' || q.state === 'SKIPPED') && !!q.lastError
      && !DECLINE_MARK.test(q.lastError) && !HOLD_MARK.test(q.lastError)
      && (declinedMs == null || qAt >= declinedMs);
    const sub: ReturnSub = held ? 'held' : queued ? 'queued' : redrafted ? 'redrafted' : failed ? 'failed' : 'waiting';
    // Qayta tayyorlangan va yurist uni portaldan sudga yuborgan (courtActive) ish — endi qaytgan emas.
    if (sub === 'redrafted' && rd?.submitted) continue;

    // Portal qatori: avval AYNAN qaytgan ish (declinedCaseId), bo'lmasa odam + firma kodi bo'yicha
    // qaytgan yozuv.
    const firmCode = c.firm?.code ?? '';
    let portal: PortalRow | null = declinedCaseId ? newest(byPortalId.get(declinedCaseId) ?? []) : null;
    if (!portal && c.pinfl) portal = newest((byPinfl.get(c.pinfl) ?? []).filter((r) => r.branchCode === firmCode && isResendRow(r)));
    const portalResult = portal ? (portal.caseResult || portal.status || null) : null;
    const portalResultLabel = portal
      ? (portal.caseResult ? (COURT_RESULT_UZ[portal.caseResult] ?? portal.caseResult) : (COURT_STATUS_UZ[portal.status] ?? portal.statusLabel ?? portal.status))
      : null;

    // Boshqa OCHIQ portal ishi (o'zimizning qaytgan/yangi suit'imizdan tashqari).
    const own = new Set([declinedCaseId, cabinetCaseId].filter((x): x is string => !!x));
    const isOwn = (r: PortalRow) => (!!r.caseNumber && own.has(r.caseNumber)) || (!!r.claimId && own.has(r.claimId));
    const dupOpen = !!c.pinfl && (byPinfl.get(c.pinfl) ?? []).some((r) => r.branchCode === firmCode && OPEN_PORTAL.has(r.status) && !isOwn(r));

    const dr = metaObj(m.declineReasons);
    const reasons = Array.isArray(dr.reasons) ? (dr.reasons as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) : [];
    const reasonCode = (REASON_CODES as string[]).includes(String(dr.code)) ? (dr.code as ReasonCode) : declineReasonCode(reasons);
    const hold = metaObj(m.resendHold);

    rows.push({
      caseId: c.id, firmId: c.firmId, firmName: c.firm?.shortName ?? '', clientName: c.clientName, pinfl: c.pinfl,
      courtName: c.court?.shortName ?? null,
      declinedAt: declinedMs != null ? new Date(declinedMs).toISOString() : null,
      declinedCaseId,
      portalResult, portalResultLabel,
      reasons, reasonCode,
      sub,
      queueError: failed ? q!.lastError : null,
      ready: rd?.ready ?? false,
      missing: rd?.missing ?? [],
      totalDebt: c.totalDebt != null ? Number(c.totalDebt) : null,
      stage: c.stage,
      receiptNumber: c.receiptNumber,
      talabnomaSent: !!c.talabnomaAt,
      flags: rd?.flags ?? null,
      sendable: rd?.sendable ?? false,
      portalCaseNumber: portal?.caseNumber ?? null,
      portalStatus: portal?.status ?? null,
      reasonsAt: str(dr.at),
      dupOpen,
      heldAt: held ? (str(hold.at) ?? null) : null,
      redraftedAt: redrafted && readyAtMs != null ? new Date(readyAtMs).toISOString() : null,
    });
  }

  // Tartib: avval amal kutayotganlar (xato, kutmoqda), keyin ushlab turilgan, navbatda, tayyorlangan;
  // har guruh ichida eng yangi qaytgan tepada.
  const rank: Record<ReturnSub, number> = { failed: 0, waiting: 1, held: 2, queued: 3, redrafted: 4 };
  rows.sort((a, b) => rank[a.sub] - rank[b.sub] || (b.declinedAt ?? '').localeCompare(a.declinedAt ?? '') || a.caseId - b.caseId);

  const bySub = emptyBySub();
  const byReason: Record<string, number> = {};
  for (const r of rows) {
    bySub[r.sub]++;
    const k = r.reasonCode ?? 'none';
    byReason[k] = (byReason[k] ?? 0) + 1;
  }
  return { rows, counts: { total: rows.length, bySub, byReason }, autoReset, snapshotId, activeJob };
}

// ── Ushlab turish / qo'yib yuborish ─────────────────────────────────────────────────────
// 2026-09-19: meta.resendHold ilgari faqat O'QILARDI (flagsFor, court-submit-job) — yozuvchisi yo'q
// edi, ya'ni faqat qo'lda SQL bilan qo'yilardi va izi qolmasdi. Endi operator tugmasi + audit.
// Qo'yib yuborishda kalit O'CHIRILADI (null emas): dvigatel `resendHold != null` ni tekshiradi.
export async function holdCases(caseIds: number[], hold: boolean, userId: number | null): Promise<{ updated: number; skippedQueued: number }> {
  const ids = [...new Set(caseIds.filter((x) => Number.isInteger(x) && x > 0))].slice(0, 2000);
  if (!ids.length) return { updated: 0, skippedQueued: 0 };
  // Faqat qaytgan ishlar — tugma boshqa bosqichdagi ishni «ushlab» qo'ya olmasin.
  const rows = await prisma.arizaCase.findMany({
    where: { id: { in: ids }, OR: [{ stage: 'COURT_RETURNED' }, { meta: { path: '$.declinedAt', string_starts_with: '2' } }] },
    select: { id: true },
  });
  // NAVBATDAGI (PENDING/RUNNING) ishni ushlab bo'lmaydi: dvigatel resendHold'ni faqat partiya boshida
  // o'qiydi va natijani eski meta ustiga yozadi — «ushlab turildi» deb ko'rsatilgan ish baribir qoralama
  // bo'lib ketardi (2026-09-19 kod ko'rigi). Avval navbatni to'xtating/kuting.
  const queued = new Set((await prisma.courtQueueItem.findMany({
    where: { caseId: { in: rows.map((r) => r.id) }, state: { in: ['PENDING', 'RUNNING'] } },
    select: { caseId: true },
  })).map((q) => q.caseId));
  const target = rows.map((r) => r.id).filter((id) => !queued.has(id));
  let updated = 0;
  if (target.length) {
    // ATOMAR: faqat resendHold kaliti o'zgaradi (JSON_SET/JSON_REMOVE) — butun meta qayta yozilmaydi,
    // shuning uchun parallel yozuv (dvigatel suitReadyAt/cabinetCaseId, outcome-sync) yo'qolmaydi.
    const at = new Date().toISOString();
    updated = hold
      ? await prisma.$executeRaw`
          UPDATE ArizaCase
          SET meta = JSON_SET(COALESCE(meta, JSON_OBJECT()), '$.resendHold', JSON_OBJECT('at', ${at}, 'userId', ${userId})), updatedAt = NOW(3)
          WHERE id IN (${Prisma.join(target)}) AND JSON_EXTRACT(COALESCE(meta, JSON_OBJECT()), '$.resendHold') IS NULL`
      : await prisma.$executeRaw`
          UPDATE ArizaCase
          SET meta = JSON_REMOVE(meta, '$.resendHold'), updatedAt = NOW(3)
          WHERE id IN (${Prisma.join(target)}) AND JSON_EXTRACT(meta, '$.resendHold') IS NOT NULL`;
  }
  await audit(AuditAction.COURT_SUBMIT, {
    target: 'sud-returns:hold',
    detail: { amal: hold ? 'Qaytgan ishlar USHLAB TURILDI' : 'Qaytgan ishlar qo‘yib yuborildi', soni: updated, navbatdaUtkazildi: queued.size, caseIds: target.slice(0, 200) },
  });
  return { updated, skippedQueued: queued.size };
}

// ── Qayta qoralama (suit) partiyasi ─────────────────────────────────────────────────────
/** Route HTTP holati + tarjima kaliti (xabar t() orqali o'tadi; `extra` — o'zgaruvchan qism). */
export class RedraftError extends Error {
  constructor(public status: number, public key: string, public extra?: string) { super(key + (extra ? ` ${extra}` : '')); }
}

/**
 * Faqat QAYTGAN ishlardan suit-rejim (stop-B) partiya: save-suit → «Murojaatlarim»da CREATED,
 * send-to-court YO'Q (u faqat «Sudga o'tkazish» tab'ida). createDraftBatch bilan AYNI job
 * parametrlari — dvigatel ikkalasini bir xil bajaradi.
 *
 * NEGA ALOHIDA (Go'dan): Go qaytganlarni yangi ishlar bilan aralash, dueAt tartibida oladi va
 * operator «faqat qaytganlarni, paket tuzatilgach» deya olmasdi; navbatdagi «Qayta yuborish» esa
 * firmaning BARCHA FAILED yozuvlarini asl rejimida (real ham) qayta yuborardi.
 *
 * Tanlov: qaytgan + sendable (5 gate, navbatda/ushlab turilgan emas) + sub waiting|failed +
 * portalda boshqa ochiq ish YO'Q (memory 2026-09-18: COMMUNITY'da 397 odamda ikkita CREATED suit —
 * qayta qoralama uchinchisini ochardi).
 */
export async function createRedraftJob(firmId: number, caseIds: number[] | undefined, userId: number | null, snapshotId?: number): Promise<{ jobId: number; total: number }> {
  // BIR VAQTDA BITTA COURT_SUBMIT job (real, qoralama, Go — hammasi): portalga ikki oqim chiqmasin.
  const active = await prisma.job.findFirst({ where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } }, select: { id: true } });
  if (active) throw new RedraftError(409, 'Hozir boshqa sud partiyasi ketmoqda — tugashini kuting.', `(#${active.id})`);

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, shortName: true, stir: true, active: true } });
  if (!firm || !firm.active) throw new RedraftError(400, 'Firma topilmadi yoki nofaol.');
  if (!digits(firm.stir)) throw new RedraftError(400, 'Firmada STIR yo‘q.');
  // Firma hujjatlari to'liq bo'lmasa paket chala ketadi (prepare-ready/resume bilan bir xil himoya).
  const haveDocs = new Set((await prisma.firmDocument.findMany({ where: { firmId }, select: { kind: true } })).map((d) => String(d.kind)));
  const missDocs = FIRM_REQUIRED_DOCS.filter((k) => !haveDocs.has(k));
  if (missDocs.length) throw new RedraftError(400, 'Firma hujjatlari yetishmaydi:', missDocs.map((k) => FIRM_DOC_LABEL[k] ?? k).join(', '));
  // Firma pauzasida suit job darhol to'xtaydi va ishlar PENDING'da qotadi — oldindan aytamiz.
  if (await isFirmPaused(firmId)) throw new RedraftError(409, 'Bu firma to‘xtatilgan (pauza) — avval davom ettiring.');

  const data = await returnedCasesForTab({ snapshotId, firmId });
  const pick = caseIds?.length ? new Set(caseIds) : null;
  const eligible = data.rows.filter((r) => (r.sub === 'waiting' || r.sub === 'failed') && r.sendable && !r.dupOpen && (!pick || pick.has(r.caseId)));
  if (!eligible.length) throw new RedraftError(400, 'Qayta qoralamaga tayyor qaytgan ish yo‘q (hujjati to‘liq, ushlab turilmagan, navbatda emas).');
  const ids = eligible.map((r) => r.caseId).slice(0, MAX_COURT_BATCH);

  // ignoreQuota=true — qoralama sud kunlik kvotasini band qilmaydi; sud faqat BIRIKTIRILADI.
  const alloc = await allocateFirmCases(firmId, ids, new Date(), undefined, true);
  let sendIds = ids;
  if (alloc) {
    sendIds = alloc.assignments.map((a) => a.caseId);
    if (!sendIds.length) throw new RedraftError(400, 'Ishlarga sud biriktirib bo‘lmadi (firma sudlari sozlanmagan).');
    await consumeCourtSend(alloc.assignments, new Date(), false);
  }

  // IDEMPOTENTLIK tuzog'i: eski (qaytgan) suit'ning DONE navbat yozuvi qolgan bo'lsa dvigatel ishni
  // «allaqachon yuborilgan» deb jim o'tkazib yuboradi (2026-09-18 qo'lda SQL bilan qaytarilganlarda
  // shunday). resetDeclinedForResend kabi DONE → FAILED qilamiz. Rejim SUIT qilib qo'yiladi: job
  // yaratilmay qolsa ham avto-davom uni REAL yuborishga olib ketmasin.
  await prisma.courtQueueItem.updateMany({
    where: { caseId: { in: sendIds }, state: 'DONE' },
    data: { state: 'FAILED', suitMode: true, draftMode: false, finishedAt: new Date(), lastError: 'Sud rad etdi — «Qaytganlar»dan qayta qoralamaga olindi.' },
  });

  const job = await prisma.job.create({
    data: {
      type: 'COURT_SUBMIT',
      status: 'PENDING',
      snapshotId: data.snapshotId ?? null,
      total: sendIds.length,
      // createDraftBatch bilan AYNI shakl (suitMode, markExported:false). sendSuits YO'Q — bu
      // partiya send-to-court QILMAYDI. userId/source — kim va qayerdan boshlagani (audit uchun).
      params: { firmId, snapshotId: data.snapshotId ?? undefined, caseIds: sendIds, ready: true, talabnomaPdf: true, includeGrafik: false, markExported: false, suitMode: true, userId, source: 'sud-returns' },
    },
  });
  enqueueJob(job.id);
  await audit(AuditAction.COURT_SUBMIT, {
    target: `sud-returns:redraft:${firmId}`,
    detail: { amal: 'Qaytganlar — qayta qoralama (suit) partiyasi', firma: firm.shortName, jobId: job.id, soni: sendIds.length },
  });
  return { jobId: job.id, total: sendIds.length };
}

// ── Rad etish sabablari (LIVE, sekin) ───────────────────────────────────────────────────
// Sabab portalda BOR: GET conflict-suit-view/{caseId} → decline_reasons[].names.uz (memory
// adolat-decline-reasons; outcome-sync'dagi «API sabab bermaydi» izohi eskirgan). Bir marta olinadi
// va meta.declineReasons = {at, reasons, code} da saqlanadi — ro'yxat va chiplar shundan (DB).
// Bir chaqiruvda ≤30 ta, KETMA-KET, umumiy pacer (paceRequest) orqali — IP bloklanmasin.
export const REASONS_PER_CALL = 30;

const asArr = (j: unknown): unknown[] => {
  if (Array.isArray(j)) return j;
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  return Array.isArray(o.content) ? o.content : Array.isArray(o.data) ? o.data : [];
};
function parseDeclineReasons(json: unknown): string[] {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
  const src = Array.isArray(o.decline_reasons) ? o.decline_reasons : Array.isArray(o.data?.decline_reasons) ? o.data.decline_reasons : [];
  const out: string[] = [];
  for (const x of src as any[]) {
    const s = typeof x === 'string' ? x : (x?.names?.uz ?? x?.names?.uz_cyr ?? x?.names?.uz_cyrl ?? x?.names?.ru ?? x?.name ?? null);
    if (typeof s === 'string' && s.trim()) out.push(s.trim());
  }
  return [...new Set(out)];
}
// Portal detalidagi haqiqiy case_id (court-return-ajrim bilan bir xil manba) — declinedCaseId yo'q
// bo'lganda zaxira.
function detailCaseId(detail: unknown): string | null {
  const parts = (detail as { participants?: unknown } | null)?.participants;
  for (const p of asArr(parts)) {
    const id = (p as { participant?: { case_id?: unknown } } | null)?.participant?.case_id;
    if (id) return String(id);
  }
  return null;
}

export interface ReasonsResult { fetched: number; failed: number; remaining: number; needAuth: string[]; stopped: string | null }

export async function fetchDeclineReasons(opts: { firmId?: number; caseIds?: number[]; snapshotId?: number }): Promise<ReasonsResult> {
  const data = await returnedCasesForTab({ snapshotId: opts.snapshotId, firmId: opts.firmId });
  const pick = opts.caseIds?.length ? new Set(opts.caseIds) : null;
  // Aniq tanlov berilsa — o'shalar (qayta olinadi). Aks holda: sababi yo'q yoki qaytishdan ESKI
  // (ish qayta qaytgan) — tayyorlanganlar (redrafted) oxirida.
  const stale = (r: ReturnRow) => !r.reasonsAt || (!!r.declinedAt && r.reasonsAt < r.declinedAt);
  // Portal id'si umuman yo'q qator (na declinedCaseId, na portal raqami) — so'rab bo'lmaydi; ular
  // navbatning boshini abadiy egallab, har chaqiruvda bir xil 30 ta «xato» bermasin.
  const todo = data.rows
    .filter((r) => (pick ? pick.has(r.caseId) : stale(r)) && (!!r.declinedCaseId || !!r.portalCaseNumber))
    .sort((a, b) => Number(a.sub === 'redrafted') - Number(b.sub === 'redrafted') || Number(!a.declinedCaseId) - Number(!b.declinedCaseId));
  const batch = todo.slice(0, REASONS_PER_CALL);
  const res: ReasonsResult = { fetched: 0, failed: 0, remaining: Math.max(0, todo.length - batch.length), needAuth: [], stopped: null };
  if (!batch.length) return res;

  // declinedCaseId yo'q qatorlar uchun portal detalidan case_id.
  const needDetail = batch.filter((r) => !r.declinedCaseId && r.portalCaseNumber).map((r) => r.portalCaseNumber!) as string[];
  const detailRows = needDetail.length
    ? await prisma.clientCaseStatus.findMany({ where: { source: 'CABINET', caseNumber: { in: needDetail } }, select: { caseNumber: true, detail: true } })
    : [];
  const detailId = new Map(detailRows.map((r) => [r.caseNumber ?? '', detailCaseId(r.detail)]));

  const firms = await prisma.firm.findMany({ where: { id: { in: [...new Set(batch.map((r) => r.firmId))] } }, select: { id: true, shortName: true, stir: true } });
  const firmById = new Map(firms.map((f) => [f.id, f]));
  const sessions = new Map<number, Awaited<ReturnType<typeof getStoredCabinetSession>> | null>();
  let consecutiveBad = 0;

  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
    const lookup = r.declinedCaseId ?? (r.portalCaseNumber ? detailId.get(r.portalCaseNumber) ?? null : null);
    if (!lookup) { res.failed++; continue; }
    if (!sessions.has(r.firmId)) {
      const f = firmById.get(r.firmId);
      try {
        sessions.set(r.firmId, await getStoredCabinetSession(digits(f?.stir)));
      } catch (e) {
        if (!(e instanceof SessionExpiredError)) throw e;
        sessions.set(r.firmId, null);
        if (f) res.needAuth.push(f.shortName);
      }
    }
    const session = sessions.get(r.firmId);
    if (!session) { res.failed++; continue; }
    await paceRequest();
    let status = 0;
    let json: unknown = null;
    try {
      const out = await getSuit(session, lookup);
      status = out.status; json = out.json;
    } catch { status = 0; }
    if (status === 401 || status === 403) {
      // Sessiya tugagan — shu firmaning qolganini urinmaymiz (har biri 4s pacer vaqtini yeydi).
      sessions.set(r.firmId, null);
      const f = firmById.get(r.firmId);
      if (f && !res.needAuth.includes(f.shortName)) res.needAuth.push(f.shortName);
      res.failed++;
      continue;
    }
    const gone = status === 400 || status === 404; // bu id bo'yicha ish yo'q (o'chirilgan/boshqa id)
    if (status !== 200 && !gone) {
      res.failed++;
      // Ketma-ket 3 ta xato (blok/429/5xx/tarmoq) — to'xtaymiz: portalni urib turish IP blokini uzaytiradi.
      if (++consecutiveBad >= 3) { res.stopped = 'portal'; res.remaining += batch.length - i - 1; break; }
      continue;
    }
    consecutiveBad = 0;
    const reasons = gone ? [] : parseDeclineReasons(json);
    // Meta'ni YOZISHDAN OLDIN qayta o'qiymiz — shu orada dvigatel (suit) meta yozgan bo'lishi mumkin.
    const cur = await prisma.arizaCase.findUnique({ where: { id: r.caseId }, select: { meta: true } });
    const m = metaObj(cur?.meta);
    // 400/404 ham yoziladi (bo'sh sabab + belgi) — aks holda har «yangilash»da qayta so'ralardi.
    m.declineReasons = { at: new Date().toISOString(), reasons, code: declineReasonCode(reasons), caseId: lookup, ...(gone ? { notFound: status } : {}) };
    await prisma.arizaCase.update({ where: { id: r.caseId }, data: { meta: m as never } });
    if (gone) res.failed++; else res.fetched++;
  }
  return res;
}
