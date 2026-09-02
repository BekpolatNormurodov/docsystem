// Invoice Excel IMPORT — «BFF …» / farmoyish formatidagi kvitansiya ro'yxatini yuklaydi.
// Ustunlar: «Қарздор ФИО» + «Квитанция рақами» (+ ixtiyoriy «Код», «Почта харажати», «PINFL», «Holat»).
// Har qatorni mijozga (F.I.O yoki PINFL bo'yicha) bog'lab, kvitansiya raqamini case'ga yozadi —
// shunda mijoz «invoice chiqarilgan» bo'ladi (receiptNumber/invoiceNo + stage INVOICE_CREATED, va
// InvoiceRecord). «Holat»=to'landi bo'lsa — to'langan deb ham belgilaydi. Avval «ko'rib chiqish»
// (preview) sonlarini beradi; tasdiqdan keyin bazaga yozadi.
import ExcelJS from 'exceljs';
import { prisma } from './db';
import { dueForStage } from './konveyer-sla';
import { getBojiAmount } from './konveyer-buxgalter';
import type { CaseStage } from '@prisma/client';

export interface InvoiceImportResult {
  applied: boolean;    // false = ko'rib chiqish; true = bazaga yozildi
  totalRows: number;   // faylda nechta qator (wuncha bor)
  matched: number;     // mijoz/case topildi (wuncha client topildi)
  willAssign: number;  // tasdiqlansa nechta YANGI kvitansiya mavjud case'ga biriktiriladi
  assigned: number;    // haqiqatda biriktirildi (apply)
  willMarkPaid: number;// «Holat»=to'landi bo'yicha
  markedPaid: number;
  alreadyHas: number;  // mijozda allaqachon kvitansiya bor (o'zgartirilmaydi)
  notFound: number;    // ARIZASI TOPILMADI — mijozning case'i yo'q (import bloklanadi)
  ambiguous: number;   // F.I.O bir nechta shaxs/case'ga to'g'ri keldi
  notFoundSamples: string[];
  notFoundRows: { name: string | null; kod: string | null; receipt: string | null }[]; // topilmaganlarni Excel qilish uchun
}

const PAID_STAGES: CaseStage[] = ['INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];
const ASSIGNABLE: CaseStage[] = ['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED'];

function unwrap(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') {
    const o = v as { richText?: { text?: string }[]; result?: unknown; text?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r?.text ?? '').join('').trim() || null;
    if (o.result !== undefined) return o.result === null ? null : String(o.result).trim() || null;
    if (o.text !== undefined) return String(o.text).trim() || null;
    return null;
  }
  return String(v).trim() || null;
}
const norm = (s: string) => s.toLowerCase().replace(/[\s.`'ʻ’]/g, '');
// F.I.O ni normalize: NFKC + katta harf + faqat harf/raqam (probel/apostrof/tinish tushadi).
// Kirill ham, lotin ham saqlanadi; «O'G'LI» va «OʻGʻLI» bir xil kalitga tushadi.
const normName = (s: string) => s.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
function findCol(header: (string | null)[], names: string[]): number {
  const wanted = names.map(norm);
  for (let i = 0; i < header.length; i++) { const h = header[i]; if (h && wanted.includes(norm(h))) return i + 1; }
  return 0;
}
function parsePaid(s: string | null): boolean | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/[\s'`ʻ’]/g, '');
  if (/(lanmagan|unpaid|тўланмаган|неоплач|\byoq\b|\bнет\b)/.test(t)) return false;
  if (/(landi|langan|paid|✓|✅|\bha\b|тўланган|оплач)/.test(t)) return true;
  return null;
}

interface Hit { id: number; firmId: number; receiptNumber: string | null; stage: CaseStage }

/** «BFF …» kvitansiya ro'yxatini o'qib, mijozlarga kvitansiya biriktiradi (opts.apply=true bo'lsa yozadi). */
export async function importInvoicesFromXlsx(filePath: string, opts: { snapshotId?: number; firmId?: number; apply: boolean }): Promise<InvoiceImportResult> {
  const { snapshotId, firmId, apply } = opts;
  const empty: InvoiceImportResult = { applied: apply, totalRows: 0, matched: 0, willAssign: 0, assigned: 0, willMarkPaid: 0, markedPaid: 0, alreadyHas: 0, notFound: 0, ambiguous: 0, notFoundSamples: [], notFoundRows: [] };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return empty;

  const header: (string | null)[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { header[col - 1] = unwrap(cell.value); });
  const cName = findCol(header, ['Қарздор ФИО', 'Қарздор Ф.И.О', 'Qarzdor F.I.O.', 'Qarzdor FIO', 'F.I.O', 'FIO', 'ФИО', 'Mijoz', 'Клиент', 'Qarzdor']);
  const cReceipt = findCol(header, ['Квитанция рақами', 'Квитанция', 'Kvitansiya raqami', 'Kvitansiya', 'receiptNumber', 'Kvitansiya №']);
  const cPinfl = findCol(header, ['PINFL', 'ПИНФЛ', 'PNFL', 'ПНФЛ', 'ЖШШИР']);
  const cKod = findCol(header, ['Код', 'Kod', 'Code', 'Кодекс']);
  const cAmount = findCol(header, ['Почта харажати', 'Pochta harajati', 'Summa', 'Сумма', 'Amount']);
  const cStatus = findCol(header, ['Holat', 'Холат', 'Holati', 'Status', 'Статус']);
  if (!cReceipt) throw new Error('«Квитанция рақами» (Kvitansiya raqami) ustuni topilmadi — «BFF …» formatidagi faylni yuklang.');
  if (!cName && !cPinfl) throw new Error('«Қарздор ФИО» yoki «PINFL» ustuni topilmadi — mijozни aniqlab boʻlmaydi.');

  interface Row { rawName: string | null; normName: string | null; pinfl: string | null; kod: string | null; receipt: string | null; amount: number | null; paid: boolean | null }
  const rows: Row[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const receipt = cReceipt ? (unwrap(row.getCell(cReceipt).value)?.replace(/\s+/g, '') || null) : null;
    const rawName = cName ? unwrap(row.getCell(cName).value) : null;
    const pinflRaw = cPinfl ? unwrap(row.getCell(cPinfl).value) : null;
    const pinfl = pinflRaw ? (pinflRaw.replace(/\D/g, '') || null) : null;
    const kod = cKod ? unwrap(row.getCell(cKod).value) : null;
    const amtRaw = cAmount ? unwrap(row.getCell(cAmount).value) : null;
    const amount = amtRaw ? (Number(amtRaw.replace(/[^\d]/g, '')) || null) : null;
    const paid = cStatus ? parsePaid(unwrap(row.getCell(cStatus).value)) : null;
    if (!receipt || (!rawName && !(pinfl && pinfl.length >= 14))) return; // kalitsiz/bo'sh qator
    rows.push({ rawName, normName: rawName ? normName(rawName) : null, pinfl: pinfl && pinfl.length >= 14 ? pinfl : null, kod, receipt, amount, paid });
  });
  if (rows.length === 0) return empty;

  const scope = { ...(firmId ? { firmId } : {}), ...(snapshotId ? { snapshotId } : {}) };
  const receipts = [...new Set(rows.map((r) => r.receipt).filter((x): x is string => !!x))];
  const pinfls = [...new Set(rows.map((r) => r.pinfl).filter((x): x is string => !!x))];
  const rawNames = [...new Set(rows.map((r) => r.rawName).filter((x): x is string => !!x))];

  // (a) Bu kvitansiyalar allaqachon bormi — biror case'da yoki InvoiceRecord'da? (har qanday firmada).
  // (b) Nomzod case'lar: firma tanlangan bo'lsa — shu firma(snapshot) HAMMA case'i (F.I.O normalize
  //     bilan solishtirish uchun); firma yo'q bo'lsa — faqat aniq mos (bounded).
  const [existRcpt, existInv, cands] = await Promise.all([
    receipts.length ? prisma.arizaCase.findMany({ where: { receiptNumber: { in: receipts } }, select: { receiptNumber: true } }) : Promise.resolve([]),
    receipts.length ? prisma.invoiceRecord.findMany({ where: { invoiceNo: { in: receipts } }, select: { invoiceNo: true } }) : Promise.resolve([]),
    (rawNames.length || pinfls.length)
      ? prisma.arizaCase.findMany({
          where: firmId
            ? scope
            : { OR: [...(pinfls.length ? [{ pinfl: { in: pinfls } }] : []), ...(rawNames.length ? [{ clientName: { in: rawNames } }] : [])], ...(snapshotId ? { snapshotId } : {}) },
          select: { id: true, firmId: true, clientName: true, pinfl: true, receiptNumber: true, stage: true },
        })
      : Promise.resolve([]),
  ]);

  const byReceipt = new Set<string>();
  for (const r of existRcpt) if (r.receiptNumber) byReceipt.add(r.receiptNumber);
  for (const r of existInv) byReceipt.add(r.invoiceNo);

  const byPinfl = new Map<string, Hit[]>();
  const byName = new Map<string, Hit[]>();
  for (const c of cands) {
    const h: Hit = { id: c.id, firmId: c.firmId, receiptNumber: c.receiptNumber, stage: c.stage };
    if (c.pinfl) { const a = byPinfl.get(c.pinfl) ?? []; a.push(h); byPinfl.set(c.pinfl, a); }
    if (c.clientName) { const k = normName(c.clientName); if (k) { const a = byName.get(k) ?? []; a.push(h); byName.set(k, a); } }
  }

  const res: InvoiceImportResult = { ...empty, totalRows: rows.length, notFoundSamples: [] };
  const plan: { caseId: number; firmId: number; receipt: string; paid: boolean }[] = [];
  const usedCase = new Set<number>();
  const usedReceipt = new Set<string>();
  for (const r of rows) {
    // Bu kvitansiya allaqachon mavjud (case/InvoiceRecord) yoki shu faylda ishlatilgan → o'tkazib yuboramiz.
    if (r.receipt && (byReceipt.has(r.receipt) || usedReceipt.has(r.receipt))) { res.alreadyHas += 1; continue; }
    const pinflHits = r.pinfl ? (byPinfl.get(r.pinfl) ?? []) : [];
    const nameHits = r.normName ? (byName.get(r.normName) ?? []) : [];
    const matchedByPinfl = pinflHits.length > 0;
    const hits = matchedByPinfl ? pinflHits : nameHits;
    // Arizasi (case'i) topilmadi — YARATMAYMIZ; «arizasi topilmaganlar» deb sanaymiz (import bloklanadi).
    // To'liq qatorni ham saqlaymiz — foydalanuvchi topilmaganlarni «o'zidek» Excel qilib olishi uchun.
    if (hits.length === 0) { res.notFound += 1; if (res.notFoundSamples.length < 20) res.notFoundSamples.push(r.rawName || r.pinfl || r.receipt || '—'); res.notFoundRows.push({ name: r.rawName, kod: r.kod, receipt: r.receipt }); continue; }
    res.matched += 1;
    // Biriktirish mumkin: kvitansiyasiz + biriktirish bosqichida (apply bilan bir xil shart) + ishlatilmagan.
    const nulls = hits.filter((h) => !h.receiptNumber && ASSIGNABLE.includes(h.stage) && !usedCase.has(h.id));
    if (nulls.length === 0) { res.alreadyHas += 1; continue; } // mijoz bor, lekin allaqachon kvitansiyali
    // Faqat F.I.O bo'yicha moslikda bir nechta nomzod — shaxsni tasdiqlab bo'lmaydi (noaniq, yozmaymiz).
    if (!matchedByPinfl && nulls.length > 1) { res.ambiguous += 1; continue; }
    const target = nulls[0];
    usedCase.add(target.id);
    usedReceipt.add(r.receipt as string);
    const paid = r.paid === true;
    plan.push({ caseId: target.id, firmId: target.firmId, receipt: r.receipt as string, paid });
    res.willAssign += 1;
    if (paid) res.willMarkPaid += 1;
  }

  // Ko'rib chiqish — YOKI biror mijozning arizasi (case'i) topilmagan bo'lsa — HECH NARSA YOZMAYMIZ.
  // Foydalanuvchi so'rovi: avval hamma mijozning arizasi bo'lishi shart; aks holda import bloklanadi
  // («saqlab bo'lmaydi»). Avval o'sha mijozlarga ariza yaratilib, keyin qayta import qilinadi.
  if (!apply || res.notFound > 0) return res;

  const now = new Date();
  const dueCreated = await dueForStage('INVOICE_CREATED', now);
  const duePaid = await dueForStage('INVOICE_PAID', now);
  // Summa — o'zimiz chiqargandagidek DEFAULT davlat boji (getBojiAmount, 22 000). Fayldagi «Почта
  // харажати» ustuni faqat ma'lumot uchun — invoice summasi bu emas.
  const amount = await getBojiAmount();

  for (const it of plan) {
    const stage: CaseStage = it.paid ? 'INVOICE_PAID' : 'INVOICE_CREATED';
    const dueAt = it.paid ? duePaid : dueCreated;
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.arizaCase.updateMany({
          where: { id: it.caseId, receiptNumber: null, stage: { in: ASSIGNABLE } },
          data: { receiptNumber: it.receipt, invoiceNo: it.receipt, stage, stageEnteredAt: now, dueAt },
        });
        if (claimed.count > 0) {
          res.assigned += 1;
          if (it.paid) res.markedPaid += 1;
          // InvoiceRecord — buzmasdan: yo'q bo'lsa yaratamiz; bor-u bog'lanmagan bo'lsa faqat caseId
          // qo'yamiz; boshqa case'ga bog'langan bo'lsa TEGMAYMIZ.
          const existing = await tx.invoiceRecord.findUnique({ where: { invoiceNo: it.receipt }, select: { caseId: true } });
          if (!existing) {
            await tx.invoiceRecord.create({ data: { invoiceNo: it.receipt, firmId: it.firmId, caseId: it.caseId, paymentType: 'Давлат божи', amount, courtType: '', courtRegion: '', court: '', status: 'CREATED' } });
          } else if (existing.caseId == null) {
            await tx.invoiceRecord.update({ where: { invoiceNo: it.receipt }, data: { caseId: it.caseId } });
          }
        }
      });
    } catch { /* bitta qator yozilmasa — qolganini davom ettiramiz */ }
  }
  return res;
}
