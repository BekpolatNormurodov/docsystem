// Hippo YETKAZGAN talabnoma xatini (xat.hippo /mail/{uid}/download) OLDINDAN yuklab, har case'ga
// CaseDocument(TALABNOMA_HIPPO) qilib biriktiradi + talabnomaAt bo'shliqlarini to'ldiradi.
//
// NEGA: ilgari bu xat hech qayerda saqlanmasdi — sud paketi (court-submit-job F) va firma-zip
// (konveyer-packet 5) har safar xat.hippo'ga jonli chiqib olardi. Sudga yuborish paytida hippo
// sekin/yopiq bo'lsa yoki sessiya tugagan bo'lsa, da'vo talabnomasiz qolardi. Endi xat bir marta
// yuklanadi va o'sha ikki joy avval saqlangan nusxani ishlatadi (hippo'ga chiqmaydi).
//
// AVTOMAT (2026-09-19): worker'ning soatlik hippo siklida (src/worker/index.ts hippoStatusSyncLoop)
// holat sinxroni, check biriktirish va yetkazilganini yangilashdan KEYIN chaqiriladi — «tayyor
// emas» ishlarning talabnomasi qo'lda skript yurgizmasdan tortiladi. Qo'lda: scripts/talabnoma-letters-prefetch.ts.
//
// FAQAT SHU FIRMA XATI: case firmasi kodida (ClientCaseStatus.branchCode) hippo yozuvi bor
// mijozlargina rejalashtiriladi. Bir odam bir necha firmada qarzdor bo'lsa, har firma unga O'Z
// talabnomasini yuborgan — boshqa kreditorning xatini bu firmaning da'vosiga biriktirib bo'lmaydi.
//
// FAQAT YETKAZILGAN XAT MUZLATILADI, va aynan YETKAZILGANLIK DALILI (check) olingan xat: saqlangan
// nusxa keyin jonli olishni to'sadi (court-submit-job F), shuning uchun sud paketida xat va check
// bir xatdan bo'lishi kerak. Nishon uid refresh-delivered-receipts.ts qoidasining O'ZI:
//   1) meta.talabnomaDelivered.uid — check shu xatdan olingan;
//   2) aks holda saqlangan check'ning (TALABNOMA_RECEIPT) o'z uid'i, agar u yetkazilgan bo'lsa;
//   3) aks holda shu firmaning ENG YANGI yetkazilgan xati (yangisi yetkazilmay, eskisi yetkazilgan).
// Xat uid'i fayl nomida saqlanadi (Talabnoma_hippo_<uid>.pdf); keyin dalil boshqa xatga ko'chsa
// (refresh yangi uid qo'ysa) — saqlangan xat o'sha xat bilan ALMASHTIRILADI (eski uid'siz nusxalar
// uchun ham — planLetters izohi). Yetkazilgan xati yo'qlar eskicha — sud paytida jonli olinadi. Idempotent.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db';
import { fetchDeliveredTalabnoma, isDelivered, isDispatched } from './talabnoma-fetch';

export const LETTER_KIND = 'TALABNOMA_HIPPO';
const DOCS = path.join(process.cwd(), 'exports', 'case-docs');

// Ochilmagan xat (egasi boshqa xodim → 403, sessiya yo'q) navbat boshini egallamasin: har muvaffaqiyatsizlikdan
// keyin kutish IKKI BARAVAR o'sadi (6s → 12s → … → 3 kun), muddati o'tganlari esa ro'yxat OXIRIGA qo'yiladi —
// limit oynasi doim hali urinilmaganlardan boshlanadi. Jarayon xotirasida (worker qayta ishga tushsa tozalanadi).
const MISS_BASE_MS = 6 * 60 * 60_000;
const MISS_MAX_MS = 3 * 24 * 60 * 60_000;
const misses = new Map<number, { at: number; n: number }>();
const missWait = (n: number) => Math.min(MISS_MAX_MS, MISS_BASE_MS * 2 ** Math.max(0, n - 1));
const recentlyMissed = (caseId: number) => { const m = misses.get(caseId); return !!m && Date.now() - m.at < missWait(m.n); };
const noteMiss = (caseId: number) => { const m = misses.get(caseId); misses.set(caseId, { at: Date.now(), n: (m?.n ?? 0) + 1 }); };

// Saqlangan xat nomidagi uid (yangi nom: Talabnoma_hippo_<uid>.pdf). Eski nom (…_<caseId>.pdf) — null.
const letterUidOf = (fileName: string): string | null => /^Talabnoma_hippo_([A-Za-z]+\d+)\.pdf$/.exec(fileName)?.[1] ?? null;
// Saqlangan check'ning uid'i (attach-receipts.ts nomlari; refresh-delivered-receipts.ts uidOf bilan bir xil).
const receiptUidOf = (d: { fileName: string; filePath: string }): string | null =>
  (/Talabnoma_kvitansiya_(.+)\.pdf$/i.exec(d.fileName) ?? /TALABNOMA_RECEIPT-(.+?)\.pdf$/i.exec(path.basename(d.filePath)))?.[1] ?? null;

const metaObj = (meta: unknown): Record<string, unknown> =>
  meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
/** Allaqachon ishlangan (qoralama/suit tayyor yoki sudga ketgan) — «tayyor emas»lar undan oldin olinadi. */
const isWorked = (c: { courtCaseId: string | null; meta: unknown }) => {
  const m = metaObj(c.meta);
  return !!(c.courtCaseId || m.draftReadyAt || m.suitReadyAt);
};

export interface LetterPlan {
  firm: { id: number; code: string | null; stir: string | null; shortName: string };
  /** Yuklanadigan ro'yxat — avval «tayyor emas» (hali ishlanmagan) ishlar. `replaceDocId` — saqlangan
   *  xat boshqa uid'niki (dalil ko'chgan), shu hujjat yangisi bilan almashtiriladi. */
  list: { caseId: number; pinfl: string; uid: string; replaceDocId?: number }[];
  candidates: number;   // shu firma kodida YETKAZILGAN hippo talabnomasi bor case'lar
  attached: number;     // ulardan allaqachon biriktirilgani
  deferred: number;     // yaqinda ochilmagan (MISS_TTL ichida qayta urinilmaydi)
  notDelivered: number; // o'z xati bor, lekin birortasi ham yetkazilmagan — jonli yo'lda qoladi
  noOwnLetter: number;  // snapshotdagi case'lar, lekin SHU firmadan hippo xati yo'q (yuborilmagan)
}

async function latestSnapshotId(): Promise<number | undefined> {
  const s = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } });
  return s?.id;
}

/** Firma bo'yicha yuklanadigan ro'yxat (faqat oxirgi yoki berilgan snapshot case'lari). */
export async function planLetters(firmId: number, snapshotId?: number): Promise<LetterPlan> {
  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, code: true, stir: true, shortName: true } });
  if (!firm) throw new Error(`Firma topilmadi: ${firmId}`);
  const empty: LetterPlan = { firm, list: [], candidates: 0, attached: 0, deferred: 0, notDelivered: 0, noOwnLetter: 0 };
  if (!firm.code) return empty;

  const snapId = snapshotId ?? (await latestSnapshotId());
  const cases = await prisma.arizaCase.findMany({
    where: { firmId, pinfl: { not: null }, ...(snapId ? { snapshotId: snapId } : {}) },
    select: { id: true, pinfl: true, courtCaseId: true, meta: true },
  });
  const hippoRows = await prisma.clientCaseStatus.findMany({
    where: {
      source: 'HIPPO', category: 'talabnoma', branchCode: firm.code, pinfl: { in: cases.map((c) => c.pinfl!) },
      caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } },
    },
    select: { pinfl: true, status: true, registryDt: true, caseNumber: true },
  });
  // Har mijoz: shu firmaning o'z (qoralama bo'lmagan) xatlari va ular orasida ENG YANGI YETKAZILGANI.
  const own = new Set<string>();
  const deliveredUids = new Map<string, Set<string>>();
  const newestDelivered = new Map<string, { uid: string; at: number }>();
  for (const r of hippoRows) {
    if (!r.pinfl || !r.caseNumber || r.status === 'CREATED') continue;
    own.add(r.pinfl);
    if (!isDelivered(r.status)) continue;
    (deliveredUids.get(r.pinfl) ?? deliveredUids.set(r.pinfl, new Set()).get(r.pinfl)!).add(r.caseNumber);
    const at = r.registryDt?.getTime() ?? 0;
    const cur = newestDelivered.get(r.pinfl);
    if (!cur || at > cur.at) newestDelivered.set(r.pinfl, { uid: r.caseNumber, at });
  }
  const ids = cases.map((c) => c.id);
  const [receiptDocs, letterDocs] = await Promise.all([
    prisma.caseDocument.findMany({ where: { caseId: { in: ids }, kind: 'TALABNOMA_RECEIPT' }, select: { caseId: true, fileName: true, filePath: true } }),
    prisma.caseDocument.findMany({ where: { caseId: { in: ids }, kind: LETTER_KIND }, select: { id: true, caseId: true, fileName: true } }),
  ]);
  const receiptUid = new Map(receiptDocs.map((d) => [d.caseId, receiptUidOf(d)]));
  const letterDoc = new Map(letterDocs.map((d) => [d.caseId, d]));
  // Nishon uid — refresh-delivered-receipts.ts bilan AYNAN bir qoida (fayl boshidagi izoh, 1→2→3).
  const targetUid = (c: (typeof cases)[number]): { uid: string; proven: boolean } | null => {
    const own = deliveredUids.get(c.pinfl!);
    const proofUid = (metaObj(c.meta).talabnomaDelivered as { uid?: string } | undefined)?.uid;
    if (proofUid && own?.has(proofUid)) return { uid: proofUid, proven: true };
    const rUid = receiptUid.get(c.id);
    if (rUid && own?.has(rUid)) return { uid: rUid, proven: false };
    const newest = newestDelivered.get(c.pinfl!)?.uid;
    return newest ? { uid: newest, proven: false } : null;
  };
  const withLetter = cases.map((c) => ({ c, t: targetUid(c) })).filter((x): x is { c: (typeof cases)[number]; t: { uid: string; proven: boolean } } => !!x.t);

  const todo: { c: (typeof cases)[number]; uid: string; replaceDocId?: number }[] = [];
  let attached = 0;
  for (const x of withLetter) {
    const doc = letterDoc.get(x.c.id);
    if (!doc) { todo.push({ c: x.c, uid: x.t.uid }); continue; }
    attached++;
    // Dalil (check) boshqa xatga ko'chgan — saqlangan xat almashtiriladi, faqat isbotlangan (meta)
    // nishon bo'yicha (taxmin bilan almashtirish yo'q):
    //   • yangi nomli nusxa — uid'i ma'lum, farq qilsa almashtiriladi;
    //   • eski nomli (uid'siz, 2026-09-19 gacha) nusxa — eski kod ENG YANGI yetkazilgan xatni saqlagan.
    //     Dalil boshqa xatdan bo'lsa, u deyarli aniq mos emas → bir martalik almashtirish (keyin nom
    //     uid'li bo'ladi va bu shart qayta ishlamaydi). Dalil eng yangisidan bo'lsa — tegilmaydi.
    const stored = letterUidOf(doc.fileName);
    const mismatch = stored ? stored !== x.t.uid : x.t.uid !== newestDelivered.get(x.c.pinfl!)?.uid;
    if (x.t.proven && mismatch) todo.push({ c: x.c, uid: x.t.uid, replaceDocId: doc.id });
  }
  const eligible = todo.filter((x) => !recentlyMissed(x.c.id));
  // Tartib: hali urinilmaganlar birinchi («tayyor emas» — ishlanmaganlar oldin, keyin id), so'ng
  // ilgari ochilmaganlar — eng uzoq kutganidan. Doimiy 403'lar limit oynasini to'sib qo'ymaydi.
  const missAt = (id: number) => misses.get(id)?.at ?? 0;
  eligible.sort((a, b) => Number(misses.has(a.c.id)) - Number(misses.has(b.c.id))
    || missAt(a.c.id) - missAt(b.c.id)
    || Number(isWorked(a.c)) - Number(isWorked(b.c)) || a.c.id - b.c.id);
  return {
    firm,
    list: eligible.map((x) => ({ caseId: x.c.id, pinfl: x.c.pinfl!, uid: x.uid, ...(x.replaceDocId ? { replaceDocId: x.replaceDocId } : {}) })),
    candidates: withLetter.length,
    attached,
    deferred: todo.length - eligible.length,
    notDelivered: cases.filter((c) => own.has(c.pinfl!) && !deliveredUids.has(c.pinfl!)).length,
    noOwnLetter: cases.filter((c) => !own.has(c.pinfl!)).length,
  };
}

type Outcome = 'attached' | 'missing' | 'failed';

async function attachOne(firm: LetterPlan['firm'], it: LetterPlan['list'][number]): Promise<Outcome> {
  const { caseId, pinfl, uid, replaceDocId } = it;
  try {
    // onlyUid — aynan yetkazilgan xat; u ochilmasa boshqa (yetkazilmagan) xat muzlatilmaydi.
    const buf = await fetchDeliveredTalabnoma(pinfl, firm.stir, firm.code, { onlyUid: uid });
    if (!buf) { noteMiss(caseId); return 'missing'; } // egasi boshqa xodim / sessiya tugagan
    const dir = path.join(DOCS, String(caseId));
    const filePath = path.join(dir, `${LETTER_KIND}-${caseId}.pdf`);
    const fileName = `Talabnoma_hippo_${uid}.pdf`; // uid nomda — keyin dalil ko'chsa taniladi
    if (replaceDocId) {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(filePath, buf);
      await prisma.caseDocument.update({ where: { id: replaceDocId }, data: { fileName, filePath, size: buf.length } });
    } else {
      // Parallel sikllar (worker + qo'lda skript) bir case'ni ikki marta biriktirmasin.
      if (await prisma.caseDocument.findFirst({ where: { caseId, kind: LETTER_KIND }, select: { id: true } })) return 'attached';
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(filePath, buf);
      await prisma.caseDocument.create({ data: { caseId, kind: LETTER_KIND, fileName, filePath, size: buf.length } });
    }
    misses.delete(caseId);
    return 'attached';
  } catch {
    noteMiss(caseId);
    return 'failed';
  }
}

export interface AttachLettersResult {
  firm: string; candidates: number; alreadyAttached: number; deferred: number; notDelivered: number; noOwnLetter: number;
  /** Yuklanishi kerak bo'lganlar jami (limitdan oldin); `todo` — shu chaqiruvda urinilgani. */
  pending: number;
  todo: number; attached: number; missing: number; failed: number;
}

/**
 * Firmaning hippo xatlarini yuklab biriktiradi. `concurrency` — parallel yuklab olish (hippo
 * rate-limitiga ehtiyot: 3). `limit` — bir chaqiruvdagi eng ko'p xat (worker sikli uchun).
 * `onProgress` har 10 tada chaqiriladi.
 */
export async function attachTalabnomaLetters(
  firmId: number,
  opts: { concurrency?: number; limit?: number; onProgress?: (done: number, total: number, r: AttachLettersResult) => void } = {},
): Promise<AttachLettersResult> {
  const plan = await planLetters(firmId);
  const list = opts.limit ? plan.list.slice(0, opts.limit) : plan.list;
  const res: AttachLettersResult = {
    firm: plan.firm.shortName, candidates: plan.candidates, alreadyAttached: plan.attached, deferred: plan.deferred,
    notDelivered: plan.notDelivered, noOwnLetter: plan.noOwnLetter, pending: plan.list.length, todo: list.length, attached: 0, missing: 0, failed: 0,
  };
  let next = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      const o = await attachOne(plan.firm, list[i]);
      res[o] += 1;
      done++;
      if (opts.onProgress && (done % 10 === 0 || done === list.length)) opts.onProgress(done, list.length, res);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, Math.max(1, list.length)) }, worker));
  return res;
}

/**
 * talabnomaAt bo'sh, lekin SHU firma kodida pochtaga CHIQQAN hippo talabnomasi bor VA UZPOST check
 * (TALABNOMA_RECEIPT) allaqachon biriktirilgan ishlar → talabnomaAt shu xatning reyestr sanasi
 * (eng birinchisi) bilan to'ldiriladi — yuborilgani ikki manbadan isbotlangan. Faqat oxirgi snapshot.
 * Sana faqat haqiqiy yuborilgan sanadan (registryDt): updatedAt oxirgi sync vaqti, soxta sana bo'lardi.
 * Qaytaradi: to'ldirilgan (dry — to'ldiriladigan) ishlar soni.
 */
export async function backfillTalabnomaDates(firmId: number, opts: { dry?: boolean } = {}): Promise<number> {
  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { code: true } });
  const snapId = await latestSnapshotId();
  if (!firm?.code || !snapId) return 0;
  const cases = await prisma.arizaCase.findMany({
    where: { firmId, snapshotId: snapId, talabnomaAt: null, pinfl: { not: null },
      documents: { some: { kind: 'TALABNOMA_RECEIPT' } } },
    select: { id: true, pinfl: true },
  });
  if (!cases.length) return 0;
  const rows = await prisma.clientCaseStatus.findMany({
    where: {
      source: 'HIPPO', category: 'talabnoma', branchCode: firm.code, pinfl: { in: cases.map((c) => c.pinfl!) },
      caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } },
    },
    select: { pinfl: true, status: true, registryDt: true },
  });
  const earliest = new Map<string, Date>();
  for (const r of rows) {
    if (!r.pinfl || !isDispatched(r.status) || !r.registryDt) continue;
    const cur = earliest.get(r.pinfl);
    if (!cur || r.registryDt < cur) earliest.set(r.pinfl, r.registryDt);
  }
  let fixed = 0;
  for (const c of cases) {
    const at = earliest.get(c.pinfl!);
    if (!at) continue;
    if (!opts.dry) await prisma.arizaCase.updateMany({ where: { id: c.id, talabnomaAt: null }, data: { talabnomaAt: at } });
    fixed++;
  }
  return fixed;
}
