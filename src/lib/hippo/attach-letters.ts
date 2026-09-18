// Hippo YETKAZGAN talabnoma xatini (xat.hippo /mail/{uid}/download) OLDINDAN yuklab, har case'ga
// CaseDocument(TALABNOMA_HIPPO) qilib biriktiradi.
//
// NEGA: ilgari bu xat hech qayerda saqlanmasdi — sud paketi (court-submit-job F) va firma-zip
// (konveyer-packet 5) har safar xat.hippo'ga jonli chiqib olardi. Sudga yuborish paytida hippo
// sekin/yopiq bo'lsa yoki sessiya tugagan bo'lsa, da'vo talabnomasiz qolardi. Endi xat bir marta
// yuklanadi va o'sha ikki joy avval saqlangan nusxani ishlatadi (hippo'ga chiqmaydi).
//
// FAQAT SHU FIRMA XATI: case firmasi kodida (ClientCaseStatus.branchCode) hippo yozuvi bor
// mijozlargina rejalashtiriladi. Bir odam bir necha firmada qarzdor bo'lsa, har firma unga O'Z
// talabnomasini yuborgan — boshqa kreditorning xatini bu firmaning da'vosiga biriktirib bo'lmaydi.
//
// FAQAT YETKAZILGAN XAT MUZLATILADI. Saqlangan nusxa keyin jonli olishni to'sadi, shuning uchun
// uni faqat pochta «yetkazildi» degan xatdan olamiz. Qolganlari (manzilda yo'q, hali yo'lda...)
// eskicha — sud paytida jonli olinadi. Idempotent (attach-receipts.ts bilan bir naqsh).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db';
import { fetchDeliveredTalabnoma, isDelivered } from './talabnoma-fetch';

export const LETTER_KIND = 'TALABNOMA_HIPPO';
const DOCS = path.join(process.cwd(), 'exports', 'case-docs');

export interface LetterPlan {
  firm: { id: number; code: string | null; stir: string | null; shortName: string };
  list: { caseId: number; pinfl: string }[];
  candidates: number;   // shu firma kodida YETKAZILGAN hippo talabnomasi bor case'lar
  attached: number;     // ulardan allaqachon biriktirilgani
  notDelivered: number; // o'z xati bor, lekin hali/umuman yetkazilmagan — jonli yo'lda qoladi
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
  const empty: LetterPlan = { firm, list: [], candidates: 0, attached: 0, notDelivered: 0, noOwnLetter: 0 };
  if (!firm.code) return empty;

  const snapId = snapshotId ?? (await latestSnapshotId());
  const cases = await prisma.arizaCase.findMany({
    where: { firmId, pinfl: { not: null }, ...(snapId ? { snapshotId: snapId } : {}) },
    select: { id: true, pinfl: true },
  });
  const hippoRows = await prisma.clientCaseStatus.findMany({
    where: {
      source: 'HIPPO', category: 'talabnoma', branchCode: firm.code, pinfl: { in: cases.map((c) => c.pinfl!) },
      caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } },
    },
    select: { pinfl: true, status: true, registryDt: true },
  });
  // Har mijozning ENG YANGI (qoralama bo'lmagan) xati — fetchDeliveredTalabnoma(deliveredOnly) ham
  // aynan shuni muzlatadi. U yetkazilgan bo'lsagina nomzod; aks holda sudda jonli olinadi.
  const newest = new Map<string, { status: string | null; at: number }>();
  for (const r of hippoRows) {
    if (!r.pinfl || r.status === 'CREATED') continue;
    const at = r.registryDt?.getTime() ?? 0;
    const cur = newest.get(r.pinfl);
    if (!cur || at > cur.at) newest.set(r.pinfl, { status: r.status, at });
  }
  const ownPinfls = new Set(newest.keys());
  const deliveredPinfls = new Set([...newest].filter(([, v]) => isDelivered(v.status)).map(([p]) => p));
  const withLetter = cases.filter((c) => deliveredPinfls.has(c.pinfl!));
  const have = new Set((await prisma.caseDocument.findMany({
    where: { caseId: { in: withLetter.map((c) => c.id) }, kind: LETTER_KIND }, select: { caseId: true },
  })).map((d) => d.caseId));

  return {
    firm,
    list: withLetter.filter((c) => !have.has(c.id)).map((c) => ({ caseId: c.id, pinfl: c.pinfl! })),
    candidates: withLetter.length,
    attached: have.size,
    notDelivered: cases.filter((c) => ownPinfls.has(c.pinfl!) && !deliveredPinfls.has(c.pinfl!)).length,
    noOwnLetter: cases.filter((c) => !ownPinfls.has(c.pinfl!)).length,
  };
}

type Outcome = 'attached' | 'missing' | 'failed';

async function attachOne(firm: LetterPlan['firm'], caseId: number, pinfl: string): Promise<Outcome> {
  try {
    const buf = await fetchDeliveredTalabnoma(pinfl, firm.stir, firm.code, { deliveredOnly: true });
    if (!buf) return 'missing'; // hech bir sessiya ochmadi (egasi boshqa xodim / sessiya tugagan)
    const dir = path.join(DOCS, String(caseId));
    await fsp.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${LETTER_KIND}-${caseId}.pdf`);
    await fsp.writeFile(filePath, buf);
    await prisma.caseDocument.create({
      data: { caseId, kind: LETTER_KIND, fileName: `Talabnoma_hippo_${caseId}.pdf`, filePath, size: buf.length },
    });
    return 'attached';
  } catch {
    return 'failed';
  }
}

export interface AttachLettersResult {
  firm: string; candidates: number; alreadyAttached: number; notDelivered: number; noOwnLetter: number;
  todo: number; attached: number; missing: number; failed: number;
}

/**
 * Firmaning hippo xatlarini yuklab biriktiradi. `concurrency` — parallel yuklab olish (hippo
 * rate-limitiga ehtiyot: 3). `onProgress` har 10 tada chaqiriladi.
 */
export async function attachTalabnomaLetters(
  firmId: number,
  opts: { concurrency?: number; limit?: number; onProgress?: (done: number, total: number, r: AttachLettersResult) => void } = {},
): Promise<AttachLettersResult> {
  const plan = await planLetters(firmId);
  const list = opts.limit ? plan.list.slice(0, opts.limit) : plan.list;
  const res: AttachLettersResult = {
    firm: plan.firm.shortName, candidates: plan.candidates, alreadyAttached: plan.attached,
    notDelivered: plan.notDelivered, noOwnLetter: plan.noOwnLetter, todo: list.length, attached: 0, missing: 0, failed: 0,
  };
  let next = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      const o = await attachOne(plan.firm, list[i].caseId, list[i].pinfl);
      res[o] += 1;
      done++;
      if (opts.onProgress && (done % 10 === 0 || done === list.length)) opts.onProgress(done, list.length, res);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, Math.max(1, list.length)) }, worker));
  return res;
}
