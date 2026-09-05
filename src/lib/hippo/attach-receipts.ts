// Talabnoma KVITANSIYASINI (UZPOST «check») xat.hippo'dan yuklab, mos case'ga
// CaseDocument(TALABNOMA_RECEIPT) qilib biriktiradi. Idempotent: allaqachon biriktirilganlarni
// o'tkazib yuboradi. Bulk (mavjudlarni bittada) VA avto (hippo sync'dan keyin yangi yuborilganlar)
// uchun bir manba. Downloadlar sekin (~2s/kvitansiya) — bir chaqiruvda LIMIT bilan cheklaymiz;
// qolgan bo'lsa qayta chaqiriladi (yoki sync'da avto davom etadi).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db';
import type { HippoSession } from './login';
import { downloadReceiptPdf } from './xat';

const DOCS = path.join(process.cwd(), 'exports', 'case-docs');
export interface AttachReceiptsResult { attached: number; skipped: number; failed: number; remaining: number; candidates: number }

export async function attachTalabnomaReceipts(session: HippoSession, firm: { id: number; code: string | null }, opts: { limit?: number } = {}): Promise<AttachReceiptsResult> {
  const limit = Math.max(1, opts.limit ?? 100);
  if (!firm.code) return { attached: 0, skipped: 0, failed: 0, remaining: 0, candidates: 0 };

  // Firma case'lari: pinfl → caseId (kvitansiyani to'g'ri case'ga biriktirish uchun).
  const cases = await prisma.arizaCase.findMany({ where: { firmId: firm.id, pinfl: { not: null } }, select: { id: true, pinfl: true } });
  const caseByPinfl = new Map<string, number>();
  for (const c of cases) if (c.pinfl && !caseByPinfl.has(c.pinfl)) caseByPinfl.set(c.pinfl, c.id);

  // Haqiqiy hippo mail uid'lari (ingested rows caseNumber'da uid saqlaydi; «TLB:…» o'zimizniki — chiqaramiz).
  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'HIPPO', category: 'talabnoma', branchCode: firm.code, pinfl: { not: null }, caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } } },
    select: { pinfl: true, caseNumber: true },
    orderBy: { updatedAt: 'desc' },
  });
  // pinfl → uid (eng oxirgisi). Case'i bor bo'lganlarnigina olamiz.
  const uidByCase = new Map<number, string>();
  for (const r of rows) {
    if (!r.pinfl || !r.caseNumber) continue;
    const cid = caseByPinfl.get(r.pinfl);
    if (cid && !uidByCase.has(cid)) uidByCase.set(cid, r.caseNumber);
  }
  const candidates = uidByCase.size;

  // Allaqachon kvitansiyasi bor case'lar — o'tkazamiz (idempotent).
  const caseIds = [...uidByCase.keys()];
  const have = new Set((await prisma.caseDocument.findMany({ where: { caseId: { in: caseIds }, kind: 'TALABNOMA_RECEIPT' }, select: { caseId: true } })).map((d) => d.caseId));
  const todo = caseIds.filter((id) => !have.has(id));

  let attached = 0, failed = 0;
  for (const caseId of todo.slice(0, limit)) {
    const uid = uidByCase.get(caseId)!;
    try {
      const b = Buffer.from(await downloadReceiptPdf(session, uid));
      const dir = path.join(DOCS, String(caseId));
      await fsp.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `TALABNOMA_RECEIPT-${uid}.pdf`);
      await fsp.writeFile(filePath, b);
      await prisma.caseDocument.create({ data: { caseId, kind: 'TALABNOMA_RECEIPT', fileName: `Talabnoma_kvitansiya_${uid}.pdf`, filePath, size: b.length } });
      attached++;
    } catch { failed++; }
  }
  return { attached, skipped: have.size, failed, remaining: Math.max(0, todo.length - Math.min(todo.length, limit)), candidates };
}
