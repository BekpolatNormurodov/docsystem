// YETKAZILGAN talabnoma kvitansiyasini (UZPOST «check») hippo'dan qayta olib, saqlangan nusxani
// almashtiradi.
//
// NEGA: check (attach-receipts.ts) xat JO'NATILGAN paytda saqlanadi — o'shanda «Етказиб берилган
// сана / ходим / Қабул қилган шахс» maydonlari BO'SH bo'ladi. Pochta xatni yetkazgach hippo o'sha
// check'ni to'ldirib beradi, lekin biz uni qayta yuklamasdik: attach idempotent, allaqachon bor
// check'ga tegmaydi. Sud buyrug'i uchun esa qarzdor xatni OLGANI isbotlanishi shart (FPK 171–173,
// 176). 2026-09-11 dan Yuqorichirchiq sudi COMMUNITY arizalarini aynan shu bilan qaytargan:
// «қарздорнинг огоҳлантириш хатини олганлиги тўғрисидаги маълумотлар тақдим қилинмаган».
//
// Bu modul hippo holati «yetkazildi» bo'lgan xatlarning check'ini qayta yuklab, o'sha fayl
// ustidan yozadi (dispatch nusxasi `.dispatch.pdf` bo'lib qoladi) va case'ga
// `meta.talabnomaDelivered` belgisini qo'yadi — court-ready'dagi yetkazilganlik gate'i shuni o'qiydi.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db';
import type { HippoSession } from './login';
import { downloadReceiptPdf } from './xat';
import { isPdf } from './talabnoma-fetch';
import { performLabel } from './mail-status';

const CONCURRENCY = 4;

export interface RefreshDeliveredResult { checked: number; refreshed: number; alreadyFresh: number; notDelivered: number; failed: number; todo: number }

// Saqlangan check'ning hippo uid'i fayl nomida turadi (attach-receipts.ts: `Talabnoma_kvitansiya_${uid}.pdf`,
// `TALABNOMA_RECEIPT-${uid}.pdf`).
function uidOf(doc: { fileName: string; filePath: string }): string | null {
  const m = /Talabnoma_kvitansiya_(.+)\.pdf$/i.exec(doc.fileName) ?? /TALABNOMA_RECEIPT-(.+?)\.pdf$/i.exec(path.basename(doc.filePath));
  return m?.[1] ?? null;
}

const metaObj = (meta: unknown): Record<string, unknown> =>
  meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {};

export async function refreshDeliveredReceipts(
  session: HippoSession,
  firm: { id: number; code: string | null },
  opts: { limit?: number } = {},
): Promise<RefreshDeliveredResult> {
  const res: RefreshDeliveredResult = { checked: 0, refreshed: 0, alreadyFresh: 0, notDelivered: 0, failed: 0, todo: 0 };
  if (!firm.code) return res;

  const docs = await prisma.caseDocument.findMany({
    where: { kind: 'TALABNOMA_RECEIPT', case: { firmId: firm.id } },
    select: { id: true, caseId: true, fileName: true, filePath: true, case: { select: { meta: true } } },
  });
  const withUid = docs.map((d) => ({ ...d, uid: uidOf(d) })).filter((d): d is typeof d & { uid: string } => !!d.uid);
  if (!withUid.length) return res;

  // Holat — xatni sinxronlagan (= kreditor) firma kodi bo'yicha; boshqa firmaning shu uid'li yozuvi olinmaydi.
  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'HIPPO', category: 'talabnoma', branchCode: firm.code, caseNumber: { in: withUid.map((d) => d.uid) } },
    select: { caseNumber: true, status: true },
  });
  const statusOf = new Map(rows.map((r) => [String(r.caseNumber), r.status]));

  const todo: typeof withUid = [];
  for (const d of withUid) {
    res.checked++;
    if (performLabel(statusOf.get(d.uid) ?? null).bucket !== 'delivered') { res.notDelivered++; continue; }
    const mark = metaObj(d.case?.meta).talabnomaDelivered as { uid?: string } | undefined;
    if (mark?.uid === d.uid) { res.alreadyFresh++; continue; }
    todo.push(d);
  }
  res.todo = todo.length;

  // Parallel yuklash — attach-receipts bilan bir xil chegara (hippo rate-limit'iga ehtiyot: 4).
  const batch = todo.slice(0, Math.max(1, opts.limit ?? 300));
  let next = 0;
  const worker = async () => { while (next < batch.length) await refreshOne(batch[next++]); };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
  return res;

  async function refreshOne(d: (typeof todo)[number]): Promise<void> {
    try {
      const b = Buffer.from(await downloadReceiptPdf(session, d.uid));
      // Sudga ketadi — xato sahifasi/bo'sh javob PDF o'rnida saqlanmasin.
      if (!isPdf(b)) { res.failed++; return; }
      let fPath = d.filePath;
      if (fPath.startsWith('/app/')) fPath = path.join(process.cwd(), fPath.replace(/^\/app\//, ''));
      // Jo'natish paytidagi nusxa izi uchun bir marta saqlanadi (qayta yangilashda ustidan yozilmaydi).
      const backup = `${fPath}.dispatch.pdf`;
      await fsp.copyFile(fPath, backup, fsp.constants.COPYFILE_EXCL).catch(() => {});
      await fsp.writeFile(fPath, b);
      await prisma.caseDocument.update({ where: { id: d.id }, data: { size: b.length } });
      const fresh = await prisma.arizaCase.findUnique({ where: { id: d.caseId }, select: { meta: true } });
      await prisma.arizaCase.update({
        where: { id: d.caseId },
        data: { meta: { ...metaObj(fresh?.meta), talabnomaDelivered: { uid: d.uid, status: statusOf.get(d.uid), refreshedAt: new Date().toISOString() } } as never },
      });
      res.refreshed++;
    } catch {
      res.failed++;
    }
  }
}
