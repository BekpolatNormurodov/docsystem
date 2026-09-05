// Talabnoma KVITANSIYASINI (UZPOST «check») xat.hippo'dan yuklab, mos case'ga
// CaseDocument(TALABNOMA_RECEIPT) qilib biriktiradi. Idempotent: allaqachon biriktirilganlarni
// o'tkazib yuboradi. Bulk (mavjudlar) VA avto (hippo sync'dan keyin) uchun bir manba.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db';
import type { HippoSession } from './login';
import { getStoredHippoSession } from './session';
import { downloadReceiptPdf } from './xat';

const DOCS = path.join(process.cwd(), 'exports', 'case-docs');
const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
export interface AttachReceiptsResult { attached: number; skipped: number; failed: number; candidates: number; todo: number }

// Eng oxirgi (aktiv) snapshot — pipeline DOIM shu snapshotда ishlaydi. Chek FAQAT shu
// snapshot (masalan 25.08) case'lariga biriktirilishi kerak — eski snapshot (31.07)
// dublikatlariga «ortiqcha» chek tushmasin (aks holda 25.08 case'i cheksiz qoladi).
async function latestSnapshotId(): Promise<number | undefined> {
  const s = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } });
  return s?.id;
}

// Firma bo'yicha biriktiriladigan (case, uid) ro'yxatini tuzadi — allaqachon kvitansiyasi
// borlar chiqarilgan (idempotent). FAQAT berilgan/oxirgi snapshot case'lari (eski snapshotlarga
// chek biriktirilmaydi — «ortiqcasi kelib birikmasin»).
async function planReceipts(firm: { id: number; code: string | null }, snapshotId?: number): Promise<{ list: { caseId: number; uid: string }[]; candidates: number; skipped: number }> {
  if (!firm.code) return { list: [], candidates: 0, skipped: 0 };
  const snapId = snapshotId ?? (await latestSnapshotId());
  const cases = await prisma.arizaCase.findMany({ where: { firmId: firm.id, pinfl: { not: null }, ...(snapId ? { snapshotId: snapId } : {}) }, select: { id: true, pinfl: true } });
  const caseByPinfl = new Map<string, number>();
  for (const c of cases) if (c.pinfl && !caseByPinfl.has(c.pinfl)) caseByPinfl.set(c.pinfl, c.id);

  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'HIPPO', category: 'talabnoma', branchCode: firm.code, pinfl: { not: null }, caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } } },
    select: { pinfl: true, caseNumber: true },
    orderBy: { updatedAt: 'desc' },
  });
  const uidByCase = new Map<number, string>();
  for (const r of rows) {
    if (!r.pinfl || !r.caseNumber) continue;
    const cid = caseByPinfl.get(r.pinfl);
    if (cid && !uidByCase.has(cid)) uidByCase.set(cid, r.caseNumber);
  }
  const caseIds = [...uidByCase.keys()];
  const have = new Set((await prisma.caseDocument.findMany({ where: { caseId: { in: caseIds }, kind: 'TALABNOMA_RECEIPT' }, select: { caseId: true } })).map((d) => d.caseId));
  const list = caseIds.filter((id) => !have.has(id)).map((id) => ({ caseId: id, uid: uidByCase.get(id)! }));
  return { list, candidates: uidByCase.size, skipped: have.size };
}

// Per-firma jonli holat (yuklamasdan): nechта nomzod, nechтаsi biriktirilgan, nechтаsi qoldi.
// DB'дан hisoblanadi — doim aniq, firma bo'yicha (panelда «state» shu).
export interface ReceiptSummary { candidates: number; attached: number; remaining: number }
export async function receiptSummary(firm: { id: number; code: string | null }): Promise<ReceiptSummary> {
  const { list, candidates, skipped } = await planReceipts(firm);
  return { candidates, attached: skipped, remaining: list.length };
}

async function attachOne(session: HippoSession, caseId: number, uid: string): Promise<boolean> {
  try {
    const b = Buffer.from(await downloadReceiptPdf(session, uid));
    const dir = path.join(DOCS, String(caseId));
    await fsp.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `TALABNOMA_RECEIPT-${uid}.pdf`);
    await fsp.writeFile(filePath, b);
    await prisma.caseDocument.create({ data: { caseId, kind: 'TALABNOMA_RECEIPT', fileName: `Talabnoma_kvitansiya_${uid}.pdf`, filePath, size: b.length } });
    return true;
  } catch { return false; }
}

/** Bir chaqiruvda (bounded) — sync'ning avto biriktirishi uchun. */
export async function attachTalabnomaReceipts(session: HippoSession, firm: { id: number; code: string | null }, opts: { limit?: number } = {}): Promise<AttachReceiptsResult> {
  const { list, candidates, skipped } = await planReceipts(firm);
  const slice = list.slice(0, Math.max(1, opts.limit ?? 100));
  let attached = 0, failed = 0;
  for (const it of slice) (await attachOne(session, it.caseId, it.uid)) ? attached++ : failed++;
  return { attached, skipped, failed, candidates, todo: list.length };
}

// ---------- background job (progress bilan) ----------
const CONCURRENCY = 4; // parallel hippo downloads (rate-limitга ehtiyot: 4)
const STALE_MS = 5 * 60 * 1000;

export async function reapStaleReceiptJobs(): Promise<void> {
  await prisma.job.updateMany({
    where: { type: 'RECEIPT_ATTACH', status: { in: ['PENDING', 'RUNNING'] }, updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: 'FAILED', message: 'Uzilib qoldi — qayta bosing' },
  }).catch(() => {});
}

/** Firmaning BARCHA kvitansiyalarini fon'da biriktiradi, Job'da progress/counts saqlaydi. */
export async function runAttachReceiptsJob(jobId: number, firmId: number): Promise<void> {
  const set = (data: Record<string, unknown>) => prisma.job.updateMany({ where: { id: jobId }, data }).catch(() => {});
  try {
    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, code: true, stir: true } });
    if (!firm) { await set({ status: 'FAILED', message: 'Firma topilmadi' }); return; }
    let session: HippoSession;
    try { session = await getStoredHippoSession(digits(firm.stir)); }
    catch { await set({ status: 'FAILED', message: 'Firma xat.hippo ga ulanmagan' }); return; }

    const { list, candidates, skipped } = await planReceipts({ id: firm.id, code: firm.code });
    const total = list.length;
    await set({ status: 'RUNNING', total, progress: 0, message: `${candidates} nomzod · ${skipped} allaqachon bor · ${total} yuklanadi` });
    if (total === 0) {
      await set({ status: 'DONE', progress: 0, total: 0, message: candidates === 0 ? '0 nomzod — avval «Sinxronlash» qiling (yoki mos case yo‘q)' : `Hammasi biriktirilgan (${skipped} ta)` });
      return;
    }

    let next = 0, attached = 0, failed = 0, done = 0, last = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= list.length) return;
        (await attachOne(session, list[i].caseId, list[i].uid)) ? attached++ : failed++;
        done++;
        if (done - last >= 5 || done === total) { last = done; await set({ progress: done, total, message: `${done}/${total} yuklandi · +${attached} biriktirildi${failed ? ` · ${failed} xato` : ''}` }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    await set({ status: 'DONE', progress: total, total, message: `Tayyor: +${attached} kvitansiya biriktirildi${failed ? ` · ${failed} xato` : ''} · ${skipped} avval bor edi` });
  } catch (e) {
    await set({ status: 'FAILED', message: e instanceof Error ? e.message : 'Xato' });
  }
}
