// «Sudga yuborish» tayyorlik + real status hisoboti. Bir mijoz (case) sudga
// CHIQARILISHI uchun 3 hujjat SHART (grafik va invoice/boji SHART EMAS):
//   1) Talabnoma yuborilgan  (talabnomaAt)
//   2) Palatadan imzolangan skan SHU case'ga biriktirilgan (CaseDocument SIGNED_ARIZA)
//   3) Oferta — har shartnomaga  (firma portfelida summKr>0 loan bor)
// Invoice/kvitansiya (receiptNumber) — `boji` flag sifatida faqat ma'lumot uchun
// hisoblanadi, sudga KETMAYDI (raqami ariza ichida boradi, ariza bojisiz).
// Bu modul faqat DB o'qiydi — chiqarilgan-yo'qligini ArizaCase.meta.exportedAt
// da saqlaymiz (schema o'zgarmasdan, db push kerak emas).
import { prisma } from './db';
import type { CaseStage } from '@prisma/client';
import { STAGE_LABEL } from './konveyer';

// Sudga allaqachon chiqib bo'lgan / yopilgan bosqichlar — «yuborishga tayyor»
// tanloviga kirmaydi (COURT_RETURNED esa qayta chiqishi kerak, shuning uchun bu
// yerda EMAS).
const SENT_STAGES = new Set<CaseStage>(['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED']);

export interface DocFlags {
  talabnoma: boolean;
  scan: boolean;
  oferta: boolean;
  boji: boolean;
  ready: boolean;
  exported: boolean;  // meta.exportedAt — «Yuborilgan» (haqiqiy chiqarilgan)
  draft: boolean;     // meta.draftAt & !exported — «Qoralama» (sinab ko'rilgan, hali haqiqiy emas)
  sendable: boolean;  // «Tayyor» — ready && hali qoralama/yuborilmagan & bosqich sudga chiqmagan
}

interface CaseRow {
  id: number;
  pinfl: string | null;
  stage: CaseStage;
  talabnomaAt: Date | null;
  receiptNumber: string | null;
  meta: unknown;
}

function metaHas(meta: unknown, key: string): boolean {
  return !!(meta && typeof meta === 'object' && !Array.isArray(meta) && (meta as Record<string, unknown>)[key]);
}
function isExported(meta: unknown): boolean { return metaHas(meta, 'exportedAt'); }
function isDraftMeta(meta: unknown): boolean { return metaHas(meta, 'draftAt'); }

function flagsFor(c: CaseRow, signedCaseIds: Set<number>, ofertaPinfls: Set<string>): DocFlags {
  const talabnoma = !!c.talabnomaAt;
  // SKAN = imzolangan ariza SHU case'ga biriktirilgan (CaseDocument SIGNED_ARIZA) — paket
  // bilan bir xil manba. Ilgari global PINFL to'plami ishlatilardi: bir odam (PINFL) boshqa
  // firmada skanlansa yoki OCR o'qilib hali biriktirilmasa ham «✓» yonardi (soxta tayyor).
  const scan = signedCaseIds.has(c.id);
  const oferta = !!(c.pinfl && ofertaPinfls.has(c.pinfl));
  // `boji` (invoice minted) is kept for info/UI only — it is NOT a court-readiness
  // requirement: the invoice/kvitansiya does not go to court (its number rides inside
  // the ariza, which stays davlat-bojisiz). Court-ready = talabnoma + scan + oferta.
  const boji = !!c.receiptNumber;
  const ready = talabnoma && scan && oferta;
  const exported = isExported(c.meta);
  const draft = !exported && isDraftMeta(c.meta); // qoralama-sinov qilingan, hali haqiqiy yuborilmagan
  // «Tayyor» = ready, hali qoralamaga ham, yuborishga ham chiqmagan, bosqichi sudda emas.
  const sendable = ready && !exported && !draft && !SENT_STAGES.has(c.stage);
  return { talabnoma, scan, oferta, boji, ready, exported, draft, sendable };
}

// SKAN tayyorligi = imzolangan ariza case'ga biriktirilgan (CaseDocument SIGNED_ARIZA).
// palata «Bazaga saqlash» (attachScannedArizas) aynan shu hujjatni yaratadi; sud paketi
// ham shuni tekshiradi — demak «Tayyor» bilan paket bir xil haqiqatga tayanadi.
async function signedCaseIdSet(caseIds: number[]): Promise<Set<number>> {
  if (caseIds.length === 0) return new Set();
  const docs = await prisma.caseDocument.findMany({ where: { caseId: { in: caseIds }, kind: 'SIGNED_ARIZA' }, select: { caseId: true } });
  return new Set(docs.map((d) => d.caseId));
}

// Firma portfelida oferta chiqariladigan (summKr>0) mijozlar PINFL to'plami.
async function ofertaPinflSet(snapshotId: number | undefined, firmCode: string | null): Promise<Set<string>> {
  if (!firmCode) return new Set();
  const loans = await prisma.loan.findMany({
    where: { ...(snapshotId ? { snapshotId } : {}), branchCode: firmCode, summKr: { gt: 0 }, pinfl: { not: null } },
    select: { pinfl: true },
    distinct: ['pinfl'],
  });
  return new Set(loans.map((l) => l.pinfl).filter((p): p is string => !!p));
}

// «almost» = cases missing EXACTLY ONE of the 4 gate docs, split by which one — i.e. one step from
// court-ready. The court/boji panels highlight these so the operator finishes the near-ready clients
// first (e.g. «N mijoz faqat boji yetmaydi»).
export interface DocQuad { talabnoma: number; scan: number; oferta: number; boji: number }
// Firma sud paketiga qo'shiladigan Sanoat-palatasi hujjatlari — 3 tasi ham MAJBURIY.
// Biror yetishmasa firma sudga yubora olmaydi (paket chala ketmasin).
export const FIRM_REQUIRED_DOCS = ['GUVOHNOMA', 'ISHONCHNOMA', 'SHARTNOMA'] as const;
export const FIRM_DOC_LABEL: Record<string, string> = { GUVOHNOMA: 'guvohnoma', ISHONCHNOMA: 'ishonchnoma', SHARTNOMA: 'shartnoma' };
export interface FirmDocsStatus { complete: boolean; missing: string[]; present: string[] }
export interface FirmReadiness {
  firmId: number;
  firmName: string;
  total: number;
  ready: number;
  exported: number;
  draft: number;
  sendable: number;
  missing: DocQuad;
  almost: DocQuad; // missing exactly this one doc (1 qadam qolgan)
  docs: FirmDocsStatus; // firma hujjatlari (guvohnoma/ishonchnoma/shartnoma) to'liqmi
}
export interface CourtReadiness {
  firms: FirmReadiness[];
  overall: { total: number; ready: number; exported: number; draft: number; sendable: number; missing: DocQuad; almost: DocQuad };
}

/** Per-firm «sudga tayyorlik»: jami / to'liq tayyor / chiqarilgan / yuborishga
 *  tayyor + qaysi hujjat yetishmayotgani (missing breakdown). */
export async function courtReadiness(snapshotId?: number, firmId?: number): Promise<CourtReadiness> {
  const firms = await prisma.firm.findMany({
    where: firmId ? { id: firmId } : {},
    select: { id: true, code: true, shortName: true },
  });

  // Firma hujjatlari (guvohnoma/ishonchnoma/shartnoma) — bir so'rovda hammasi.
  const firmDocRows = await prisma.firmDocument.findMany({ where: { firmId: { in: firms.map((f) => f.id) } }, select: { firmId: true, kind: true } });
  const docKindsByFirm = new Map<number, Set<string>>();
  for (const d of firmDocRows) { const s = docKindsByFirm.get(d.firmId) ?? new Set(); s.add(String(d.kind)); docKindsByFirm.set(d.firmId, s); }
  const firmDocsStatus = (fid: number): FirmDocsStatus => {
    const have = docKindsByFirm.get(fid) ?? new Set<string>();
    const missing = FIRM_REQUIRED_DOCS.filter((k) => !have.has(k));
    return { complete: missing.length === 0, missing: missing.map((k) => FIRM_DOC_LABEL[k] ?? k), present: FIRM_REQUIRED_DOCS.filter((k) => have.has(k)).map((k) => FIRM_DOC_LABEL[k] ?? k) };
  };

  // Firms in parallel (was sequential — N round-trips of case-scan + oferta-scan on the
  // aggregate «Hamma firma» load). Each firm's two queries already run together.
  const perFirm = await Promise.all(firms.map(async (f): Promise<FirmReadiness | null> => {
    const [cases, ofertaPinfls] = await Promise.all([
      prisma.arizaCase.findMany({
        where: { firmId: f.id, ...(snapshotId ? { snapshotId } : {}) },
        select: { id: true, pinfl: true, stage: true, talabnomaAt: true, receiptNumber: true, meta: true },
        orderBy: { id: 'asc' },
      }),
      ofertaPinflSet(snapshotId, f.code),
    ]);
    if (cases.length === 0) return null;
    const signedIds = await signedCaseIdSet(cases.map((c) => c.id));

    const fr: FirmReadiness = {
      firmId: f.id, firmName: f.shortName, total: cases.length,
      ready: 0, exported: 0, draft: 0, sendable: 0,
      missing: { talabnoma: 0, scan: 0, oferta: 0, boji: 0 },
      almost: { talabnoma: 0, scan: 0, oferta: 0, boji: 0 },
      docs: firmDocsStatus(f.id),
    };
    for (const c of cases as CaseRow[]) {
      const fl = flagsFor(c, signedIds, ofertaPinfls);
      if (fl.ready) fr.ready++;
      if (fl.exported) fr.exported++;
      if (fl.draft) fr.draft++;
      if (fl.sendable) fr.sendable++;
      if (!fl.talabnoma) fr.missing.talabnoma++;
      if (!fl.scan) fr.missing.scan++;
      if (!fl.oferta) fr.missing.oferta++;
      if (!fl.boji) fr.missing.boji++;
      // «1 qadam qolgan» — exactly one of the THREE court-gate docs missing (talabnoma/scan/oferta).
      // boji is NOT a gate doc (see flagsFor), so a case missing only boji is already court-ready and
      // must not be counted here.
      const gaps = (fl.talabnoma ? 0 : 1) + (fl.scan ? 0 : 1) + (fl.oferta ? 0 : 1);
      if (gaps === 1 && !fl.exported && !SENT_STAGES.has(c.stage)) {
        if (!fl.talabnoma) fr.almost.talabnoma++;
        else if (!fl.scan) fr.almost.scan++;
        else fr.almost.oferta++;
      }
    }
    return fr;
  }));
  const firmsOut = perFirm.filter((x): x is FirmReadiness => x !== null);
  firmsOut.sort((a, b) => b.total - a.total);

  const overall = firmsOut.reduce(
    (o, f) => {
      o.total += f.total; o.ready += f.ready; o.exported += f.exported; o.draft += f.draft; o.sendable += f.sendable;
      o.missing.talabnoma += f.missing.talabnoma; o.missing.scan += f.missing.scan;
      o.missing.oferta += f.missing.oferta; o.missing.boji += f.missing.boji;
      o.almost.talabnoma += f.almost.talabnoma; o.almost.scan += f.almost.scan;
      o.almost.oferta += f.almost.oferta; o.almost.boji += f.almost.boji;
      return o;
    },
    { total: 0, ready: 0, exported: 0, draft: 0, sendable: 0, missing: { talabnoma: 0, scan: 0, oferta: 0, boji: 0 }, almost: { talabnoma: 0, scan: 0, oferta: 0, boji: 0 } },
  );

  return { firms: firmsOut, overall };
}

// ── Per-client (case-level) drill-down: the 4-doc checklist, filterable ───────
export type ReadyFilter = 'all' | 'sendable' | 'draft' | 'ready' | 'exported' | 'notready';
export interface ClientReadyRow {
  caseId: number;
  clientName: string | null;
  pinfl: string | null;
  stage: CaseStage;
  stageLabel: string;
  talabnoma: boolean;
  scan: boolean;
  oferta: boolean;
  boji: boolean;
  ready: boolean;
  exported: boolean;
  draft: boolean;
  sendable: boolean;
  totalDebt: string;
  daysLeft: number | null;
  receiptNumber: string | null; // real boji kvitansiya № (for the drill-down CaseDocs invoice slot)
}
export interface ClientReadyCounts { all: number; sendable: number; draft: number; ready: number; exported: number; notready: number }
export interface ClientReadyPage {
  rows: ClientReadyRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  counts: ClientReadyCounts;
}

/** Per-client readiness rows for ONE firm — the 4-doc checklist per case, filterable
 *  (all/sendable/ready/exported/notready), searchable (name/PINFL), paged. Counts are
 *  computed over the search-filtered set so the filter chips stay honest. */
export async function firmReadyClients(opts: {
  snapshotId?: number; firmId: number;
}): Promise<ClientReadyPage> {
  const empty: ClientReadyPage = { rows: [], total: 0, page: 1, pageSize: 0, pages: 1, counts: { all: 0, sendable: 0, draft: 0, ready: 0, exported: 0, notready: 0 } };

  const firm = await prisma.firm.findUnique({ where: { id: opts.firmId }, select: { id: true, code: true } });
  if (!firm) return empty;
  const [cases, ofertaPinfls] = await Promise.all([
    prisma.arizaCase.findMany({
      where: { firmId: firm.id, ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}) },
      select: { id: true, pinfl: true, clientName: true, stage: true, talabnomaAt: true, receiptNumber: true, meta: true, totalDebt: true, dueAt: true },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    }),
    ofertaPinflSet(opts.snapshotId, firm.code),
  ]);
  const signedIds = await signedCaseIdSet(cases.map((c) => c.id));
  const now = Date.now();
  const day = 86400000;

  // ALL rows + counts in ONE query — the drill-down filters/searches/paginates client-side, so a
  // filter or page switch never re-hits the DB. That per-interaction refetch (each loading the whole
  // firm's cases + meta) was the «juda sekin»; now the firm is loaded once when the drill-down opens.
  const counts: ClientReadyCounts = { all: 0, sendable: 0, draft: 0, ready: 0, exported: 0, notready: 0 };
  const rows: ClientReadyRow[] = [];
  for (const c of cases) {
    const fl = flagsFor(c as CaseRow, signedIds, ofertaPinfls);
    counts.all++;
    if (fl.sendable) counts.sendable++;
    if (fl.draft) counts.draft++;
    if (fl.ready) counts.ready++;
    if (fl.exported) counts.exported++;
    if (!fl.ready) counts.notready++;
    rows.push({
      caseId: c.id, clientName: c.clientName, pinfl: c.pinfl, stage: c.stage, stageLabel: STAGE_LABEL[c.stage],
      talabnoma: fl.talabnoma, scan: fl.scan, oferta: fl.oferta, boji: fl.boji,
      ready: fl.ready, exported: fl.exported, draft: fl.draft, sendable: fl.sendable,
      totalDebt: String(c.totalDebt),
      daysLeft: c.dueAt ? ((v: number) => (v < 0 ? Math.floor(v) : Math.ceil(v)))((c.dueAt.getTime() - now) / day) : null,
      receiptNumber: c.receiptNumber,
    });
  }
  return { rows, total: rows.length, page: 1, pageSize: rows.length, pages: 1, counts };
}

/** Yuborishga tayyor (ready && !exported && bosqich sudga chiqmagan) case id'lari,
 *  firma bo'yicha, eng eskisidan boshlab, `limit` tagacha. `includeExported` —
 *  qaytganlar/tuzatilganlarni qayta chiqarish uchun. */
export async function selectReadyCaseIds(opts: {
  snapshotId?: number; firmId: number; limit: number; includeExported?: boolean;
}): Promise<number[]> {
  const firm = await prisma.firm.findUnique({ where: { id: opts.firmId }, select: { id: true, code: true } });
  if (!firm) return [];
  const [cases, ofertaPinfls] = await Promise.all([
    prisma.arizaCase.findMany({
      where: { firmId: firm.id, ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}) },
      select: { id: true, pinfl: true, stage: true, talabnomaAt: true, receiptNumber: true, meta: true },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    }),
    ofertaPinflSet(opts.snapshotId, firm.code),
  ]);
  const signedIds = await signedCaseIdSet(cases.map((c) => c.id));
  const picked: number[] = [];
  for (const c of cases as CaseRow[]) {
    const fl = flagsFor(c, signedIds, ofertaPinfls);
    if (!fl.ready) continue;
    if (SENT_STAGES.has(c.stage)) continue;
    if (!opts.includeExported && fl.exported) continue;
    picked.push(c.id);
    if (picked.length >= opts.limit) break;
  }
  return picked;
}

/** Foydalanuvchi qo'lda tanlagan case id'larni SERVER tomonda qayta tekshirish —
 *  faqat o'sha firmaga tegishli, to'liq tayyor, sudga chiqmagan (va includeExported
 *  bo'lmasa chiqarilmagan) bo'lganlari qaytadi. Eskirgan tanlov ZIP'ga nomos case
 *  «olib kira» olmaydi (client filtri hech qachon avtorizatsiya sifatida ishonilmaydi). */
export async function validateSelectedCaseIds(opts: {
  snapshotId?: number; firmId: number; caseIds: number[]; includeExported?: boolean; limit?: number;
}): Promise<number[]> {
  const firm = await prisma.firm.findUnique({ where: { id: opts.firmId }, select: { id: true, code: true } });
  if (!firm || !opts.caseIds.length) return [];
  const [cases, ofertaPinfls] = await Promise.all([
    prisma.arizaCase.findMany({
      where: { id: { in: opts.caseIds }, firmId: firm.id, ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}) },
      select: { id: true, pinfl: true, stage: true, talabnomaAt: true, receiptNumber: true, meta: true },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    }),
    ofertaPinflSet(opts.snapshotId, firm.code),
  ]);
  const signedIds = await signedCaseIdSet(cases.map((c) => c.id));
  return (cases as CaseRow[])
    .filter((c) => {
      const fl = flagsFor(c, signedIds, ofertaPinfls);
      return fl.ready && !SENT_STAGES.has(c.stage) && (opts.includeExported || !fl.exported);
    })
    .map((c) => c.id)
    .slice(0, Math.min(100, opts.limit ?? 100));
}

/** Chiqarilgan deb belgilash — ArizaCase.meta.exportedAt (JSON merge, schema
 *  o'zgarmaydi). Paket ZIP tayyor bo'lgach chaqiriladi. */
export async function markCasesExported(caseIds: number[]): Promise<void> {
  if (!caseIds.length) return;
  const rows = await prisma.arizaCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, meta: true } });
  const now = new Date().toISOString();
  // Parallel (was N sequential round-trips). Each targets a distinct id and keeps the
  // per-row best-effort .catch; capped at ≤100 ids so pool pressure stays bounded.
  await Promise.all(rows.map((r) => {
    const base = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? { ...(r.meta as Record<string, unknown>) } : {};
    base.exportedAt = now;
    return prisma.arizaCase.update({ where: { id: r.id }, data: { meta: base as never } }).catch(() => {});
  }));
}

/** «Bekor qilish» — clear the court send/draft marks (meta.exportedAt / meta.draftAt) so the cases
 *  return to «Tayyor». Undo of a real send OR a qoralama. Returns how many were actually reverted. */
export async function undoCaseState(caseIds: number[]): Promise<number> {
  if (!caseIds.length) return 0;
  // Sud kunlik limitini ham qaytaramiz — bekor qilingan yuborish quotani band qilib qolmasin.
  await prisma.arizaCase.updateMany({ where: { id: { in: caseIds.slice(0, 200) } }, data: { courtSentAt: null } }).catch(() => {});
  const rows = await prisma.arizaCase.findMany({ where: { id: { in: caseIds.slice(0, 200) } }, select: { id: true, meta: true } });
  let reverted = 0;
  await Promise.all(rows.map((r) => {
    const base = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? { ...(r.meta as Record<string, unknown>) } : {};
    if (!base.exportedAt && !base.draftAt) return Promise.resolve();
    delete base.exportedAt; delete base.draftAt;
    reverted++;
    return prisma.arizaCase.update({ where: { id: r.id }, data: { meta: base as never } }).catch(() => {});
  }));
  return reverted;
}

// ── Real status hisoboti (ClientCaseStatus — Adolat/hippo ingest) ────────────
// Two DIFFERENT axes: CABINET = sud (court) ish holati; HIPPO = talabnoma (pochta)
// yetkazish holati. Buckets carry `source` so the UI can segment (Sud / Talabnoma).
export interface StatusBucket { code: string; label: string; tone: string; count: number; source: string }
export interface CourtStatusBoard {
  total: number;
  matched: number;   // portfel mijoziga bog'langan (pinfl bor)
  buckets: StatusBucket[];
  sources: Record<string, number>; // CABINET / HIPPO
}

type Cls = { code: string; label: string; tone: string };
// CABINET court OUTCOME (caseResult is ENGLISH — the decisive result when present).
const CABINET_RESULT: Record<string, Cls> = {
  FULFILLED: { code: 'SATISFIED', label: 'Qanoatlantirilgan', tone: 'emerald' },
  RETURNED: { code: 'RETURNED', label: 'Qaytarilgan', tone: 'rose' },
  REFUSED: { code: 'DECLINED', label: 'Rad etilgan', tone: 'rose' },
  UNCONSIDERED: { code: 'UNCONSIDERED', label: 'Ko‘rilmasdan qoldirilgan', tone: 'slate' },
};
// CABINET process status (English) — when no decisive result yet.
const CABINET_STATUS: Record<string, Cls> = {
  DRAFT: { code: 'DRAFT', label: 'Qoralama', tone: 'slate' },
  CREATED: { code: 'CREATED', label: 'Kelgan (ro‘yxatda)', tone: 'sky' },
  PENDING: { code: 'PENDING', label: 'Kutilmoqda', tone: 'amber' },
  IN_PROCESS: { code: 'IN_PROCESS', label: 'Ko‘rilmoqda', tone: 'blue' },
  DECIDED: { code: 'DECIDED', label: 'Qaror chiqdi', tone: 'violet' },
  FINISHED: { code: 'FINISHED', label: 'Yakunlangan', tone: 'emerald' },
  DECLINED: { code: 'DECLINED', label: 'Rad etilgan', tone: 'rose' },
};
// HIPPO talabnoma POSTAL delivery outcome (the `status` field; caseResult="Success" is noise).
const HIPPO_STATUS: Record<string, Cls> = {
  SUCCESSDELIVERED: { code: 'DELIVERED', label: 'Yetkazildi', tone: 'emerald' },
  SUCCESS: { code: 'SENT', label: 'Yuborildi', tone: 'sky' },
  INCOMPLETEADDRESS: { code: 'ADDR', label: 'Manzil noto‘liq', tone: 'amber' },
  RECEIVERNOTLIVESTHERE: { code: 'NOTLIVE', label: 'Bu manzilda yashamaydi', tone: 'amber' },
  DIDNTAPPEARONNOTICE: { code: 'NOSHOW', label: 'Chaqiruvga kelmadi', tone: 'amber' },
  NOTATHOME: { code: 'NOTHOME', label: 'Uyda yo‘q', tone: 'amber' },
  RECEIVERREFUSE: { code: 'REFUSE', label: 'Qabul qilmadi', tone: 'rose' },
  RECEIVERDEAD: { code: 'DEAD', label: 'Qarzdor vafot etgan', tone: 'slate' },
};

// Source-aware so the same raw string never lands in the wrong vocabulary. Unknown
// codes still surface (Uzbek statusLabel for CABINET, «Boshqa» for HIPPO) — nothing dropped.
function classifyStatus(source: string, row: { status: string; statusLabel: string | null; caseResult: string | null }): Cls {
  const st = (row.status || '').trim();
  const stU = st.toUpperCase();
  if (source === 'CABINET') {
    const res = (row.caseResult || '').trim();
    const resU = res.toUpperCase();
    const resL = res.toLowerCase();
    if (resL.includes('qanoatlantir') && resL.includes('qisman')) return { code: 'PARTIAL', label: 'Qisman qanoatlantirilgan', tone: 'amber' };
    if (CABINET_RESULT[resU]) return CABINET_RESULT[resU]; // English outcome wins
    if (CABINET_STATUS[stU]) return CABINET_STATUS[stU];
    const lbl = row.statusLabel || st || 'Noma’lum'; // key by the localized label so dups merge
    return { code: `C_${lbl}`, label: lbl, tone: 'slate' };
  }
  // HIPPO delivery
  if (HIPPO_STATUS[stU]) return HIPPO_STATUS[stU];
  return { code: 'H_OTHER', label: 'Boshqa (yetkazish)', tone: 'slate' }; // numeric/unknown codes → one bucket
}

/** ClientCaseStatus'ni Uzbek toifalarga guruhlab, to'liq status hisoboti.
 *  Hech qaysi status tashlab ketilmaydi. */
export async function courtStatusBoard(snapshotId?: number, firmId?: number): Promise<CourtStatusBoard> {
  let branchCode: string | undefined;
  if (firmId) {
    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { code: true } });
    branchCode = firm?.code ?? '__none__';
  }
  const where = { ...(branchCode ? { branchCode } : {}), ...(snapshotId ? { snapshotId } : {}) };
  // Group in the DB rather than loading every row: classifyStatus is a pure function of
  // (status, statusLabel, caseResult), so classifying each DISTINCT combo once and summing
  // its _count is identical to classifying every row — far less transfer + no big JS loop.
  const [grouped, matched] = await Promise.all([
    // Deterministic order so the representative label of an unmapped-status bucket (and the
    // left-right position of equal-count buckets) is stable across builds — counts are
    // identical either way; only which label variant "wins" for an ambiguous code was unstable.
    prisma.clientCaseStatus.groupBy({
      by: ['status', 'statusLabel', 'caseResult', 'source'],
      where,
      _count: { _all: true },
      orderBy: [{ status: 'asc' }, { statusLabel: 'asc' }, { caseResult: 'asc' }],
    }),
    prisma.clientCaseStatus.count({ where: { ...where, pinfl: { not: null } } }),
  ]);

  const byCode = new Map<string, StatusBucket>();
  const sources: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    const cnt = g._count._all;
    total += cnt;
    sources[g.source] = (sources[g.source] ?? 0) + cnt;
    const c = classifyStatus(g.source, g);
    // Key by source+code so a court bucket and a delivery bucket never merge, and the UI can segment.
    const key = `${g.source}:${c.code}`;
    const b = byCode.get(key) ?? { code: c.code, label: c.label, tone: c.tone, count: 0, source: g.source };
    b.count += cnt;
    byCode.set(key, b);
  }
  const buckets = [...byCode.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { total, matched, buckets, sources };
}

// ── Qaytganlar (to'ldirib qayta yuborish) ────────────────────────────────────
export interface ReturnCase {
  caseId: number;
  clientName: string | null;
  pinfl: string | null;
  firmId: number;
  firmName: string;
  stage: CaseStage;
  stageLabel: string;
  receiptNumber: string | null;
  talabnomaSent: boolean;
  totalDebt: string;
  daysLeft: number | null;
  docCount: number;
}

const RETURN_STAGES: CaseStage[] = ['COURT_RETURNED', 'CHAMBER_RETURNED'];

/** Qaytgan ishlar (sud qaytardi / palatadan qaytgan) — to'ldirib, belgilab,
 *  qayta yuborish uchun. */
export async function courtReturns(snapshotId?: number, firmId?: number): Promise<ReturnCase[]> {
  const rows = await prisma.arizaCase.findMany({
    where: { stage: { in: RETURN_STAGES }, ...(snapshotId ? { snapshotId } : {}), ...(firmId ? { firmId } : {}) },
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, clientName: true, pinfl: true, firmId: true, stage: true, receiptNumber: true,
      talabnomaAt: true, totalDebt: true, dueAt: true,
      firm: { select: { shortName: true } },
      _count: { select: { documents: true } },
    },
  });
  const now = Date.now();
  const day = 86400000;
  return rows.map((r) => ({
    caseId: r.id,
    clientName: r.clientName,
    pinfl: r.pinfl,
    firmId: r.firmId,
    firmName: r.firm?.shortName ?? '',
    stage: r.stage,
    stageLabel: STAGE_LABEL[r.stage],
    receiptNumber: r.receiptNumber,
    talabnomaSent: !!r.talabnomaAt,
    totalDebt: String(r.totalDebt),
    daysLeft: r.dueAt ? ((v: number) => (v < 0 ? Math.floor(v) : Math.ceil(v)))((r.dueAt.getTime() - now) / day) : null,
    docCount: r._count.documents,
  }));
}
