// Invoice Excel IMPORT — buxgalter/konveyer «To'lov holati»ni Excel'dan yuklaydi (reconcile).
// Har qatorni kvitansiya raqami / invoice raqami / PINFL bo'yicha mavjud case'ga bog'laydi va
// «Holat» ustuniga qarab to'langan (INVOICE_CREATED→INVOICE_PAID) yoki qaytarilgan
// (INVOICE_PAID→INVOICE_CREATED) deb belgilaydi. Mavjud «To'landi» tugmasi bilan bir xil guard.
import ExcelJS from 'exceljs';
import { prisma } from './db';
import { dueForStage } from './konveyer-sla';
import type { CaseStage } from '@prisma/client';

export interface InvoiceReconcileResult {
  applied: boolean;    // false = faqat ko'rib chiqish (preview); true = yozildi
  totalRows: number;   // ma'lumotli qatorlar (kalit topilgan)
  matched: number;     // case'ga bog'landi
  willMarkPaid: number;  // tasdiqlansa nechta YANGI «to'landi» bo'ladi
  willMarkUnpaid: number;// tasdiqlansa nechta qaytariladi
  markedPaid: number;  // haqiqatda «to'landi» belgilandi (apply)
  markedUnpaid: number;// haqiqatda qaytarildi (apply)
  alreadyPaid: number; // «bor» — allaqachon to'langan (o'zgartirilmaydi)
  alreadyUnpaid: number;
  notFound: number;    // mos case topilmadi
  ambiguous: number;   // PINFL bir nechta case'ga to'g'ri keldi (kvitansiyasiz)
  noStatus: number;    // topildi, lekin «Holat» aniq emas — o'zgartirilmadi
  notFoundSamples: string[]; // birinchi ~20 topilmagan (kvitansiya/PINFL) — foydalanuvchiga
}

// «To'langan» hisoblangan bosqichlar (sud/MIB'ga o'tsa ham to'langan).
const PAID_STAGES: CaseStage[] = ['INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];

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
function findCol(header: (string | null)[], names: string[]): number {
  const wanted = names.map(norm);
  for (let i = 0; i < header.length; i++) { const h = header[i]; if (h && wanted.includes(norm(h))) return i + 1; }
  return 0;
}

/** «Holat» matnidan to'lov holati: true=to'langan, false=to'lanmagan, null=noaniq (o'zgartirilmaydi). */
function parsePaid(s: string | null): boolean | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/[\s'`ʻ’]/g, '');
  // Avval «to'lanmagan»ni tekshiramiz (u ham «...lan...»ni o'z ichiga oladi).
  if (/(lanmagan|unpaid|notpaid|тўланмаган|неоплач|нетоплач|\byoq\b|\bнет\b|\bno\b|\bfalse\b|to'lanmagan)/.test(t)) return false;
  if (/(landi|langan|paid|✓|✅|\bha\b|\b1\b|\btrue\b|\bда\b|тўланган|оплач|бажарилди)/.test(t)) return true;
  return null;
}

/**
 * Excel'ni o'qib, to'lov holatini mavjud case'larga solishtiradi (reconcile).
 * opts.apply=false — faqat sonlarni ko'rsatadi (preview, hech narsa yozilmaydi);
 * opts.apply=true — tasdiqdan keyin haqiqatda «to'landi/qaytarildi» qiladi.
 */
export async function reconcileInvoicesFromXlsx(filePath: string, opts: { snapshotId?: number; apply: boolean }): Promise<InvoiceReconcileResult> {
  const { snapshotId, apply } = opts;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const empty: InvoiceReconcileResult = { applied: apply, totalRows: 0, matched: 0, willMarkPaid: 0, willMarkUnpaid: 0, markedPaid: 0, markedUnpaid: 0, alreadyPaid: 0, alreadyUnpaid: 0, notFound: 0, ambiguous: 0, noStatus: 0, notFoundSamples: [] };
  if (!ws) return empty;

  const header: (string | null)[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { header[col - 1] = unwrap(cell.value); });
  const cReceipt = findCol(header, ['Kvitansiya raqami', 'Kvitansiya', 'Квитанция', 'Квитанция рақами', 'receiptNumber', 'Kvitansiya №', 'Kvitansiya no']);
  const cInvoice = findCol(header, ['Invoice raqami', 'Invoice', 'Инвойс', 'invoiceNo', 'Invoys raqami', 'Invoys']);
  const cPinfl = findCol(header, ['PINFL', 'ПИНФЛ', 'PNFL', 'ПНФЛ', 'ЖШШИР', 'Jshshir']);
  const cStatus = findCol(header, ['Holat', 'Холат', 'Holati', 'Status', 'Toʻlandi', 'Tolandi', "To'landi", 'Оплата', 'Статус', 'To‘lov']);
  if (!cReceipt && !cInvoice && !cPinfl) {
    throw new Error('Ustun topilmadi — Excel’da «Kvitansiya raqami», «Invoice raqami» yoki «PINFL» sarlavhasi bo‘lishi kerak.');
  }

  interface Row { receiptNumber: string | null; invoiceNo: string | null; pinfl: string | null; paid: boolean | null }
  const rows: Row[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const receiptNumber = cReceipt ? (unwrap(row.getCell(cReceipt).value)?.replace(/\s+/g, '') || null) : null;
    const invoiceNo = cInvoice ? (unwrap(row.getCell(cInvoice).value)?.replace(/\s+/g, '') || null) : null;
    const pinflRaw = cPinfl ? unwrap(row.getCell(cPinfl).value) : null;
    const pinfl = pinflRaw ? (pinflRaw.replace(/\D/g, '') || null) : null;
    const status = cStatus ? unwrap(row.getCell(cStatus).value) : null;
    if (!receiptNumber && !invoiceNo && !(pinfl && pinfl.length >= 14)) return; // bo'sh/kalitsiz qator
    rows.push({ receiptNumber, invoiceNo, pinfl: pinfl && pinfl.length >= 14 ? pinfl : null, paid: parsePaid(status) });
  });
  if (rows.length === 0) return empty;

  // Nomzod case'lar — kvitansiya / invoice / PINFL bo'yicha.
  const receipts = [...new Set(rows.map((r) => r.receiptNumber).filter((x): x is string => !!x))];
  const invoices = [...new Set(rows.map((r) => r.invoiceNo).filter((x): x is string => !!x))];
  const pinfls = [...new Set(rows.map((r) => r.pinfl).filter((x): x is string => !!x))];
  const or = [
    ...(receipts.length ? [{ receiptNumber: { in: receipts } }] : []),
    ...(invoices.length ? [{ invoiceNo: { in: invoices } }] : []),
    ...(pinfls.length ? [{ pinfl: { in: pinfls }, receiptNumber: { not: null }, ...(snapshotId ? { snapshotId } : {}) }] : []),
  ];
  const cands = or.length
    ? await prisma.arizaCase.findMany({ where: { OR: or }, select: { id: true, receiptNumber: true, invoiceNo: true, pinfl: true, stage: true } })
    : [];

  type Hit = { id: number; stage: CaseStage };
  const byReceipt = new Map<string, Hit>();
  const byInvoice = new Map<string, Hit>();
  const byPinfl = new Map<string, Hit[]>();
  for (const c of cands) {
    const h: Hit = { id: c.id, stage: c.stage };
    if (c.receiptNumber) byReceipt.set(c.receiptNumber, h);
    if (c.invoiceNo) byInvoice.set(c.invoiceNo, h);
    if (c.pinfl && c.receiptNumber) { const a = byPinfl.get(c.pinfl) ?? []; a.push(h); byPinfl.set(c.pinfl, a); }
  }

  const res: InvoiceReconcileResult = { ...empty, totalRows: rows.length, notFoundSamples: [] };
  const toPaid: number[] = [];
  const toUnpaid: number[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    let hit: Hit | null = (r.receiptNumber && byReceipt.get(r.receiptNumber)) || (r.invoiceNo && byInvoice.get(r.invoiceNo)) || null;
    if (!hit && r.pinfl) {
      const a = byPinfl.get(r.pinfl);
      if (a && a.length === 1) hit = a[0];
      else if (a && a.length > 1) { res.ambiguous += 1; continue; }
    }
    if (!hit) { res.notFound += 1; if (res.notFoundSamples.length < 20) res.notFoundSamples.push(r.receiptNumber || r.invoiceNo || r.pinfl || '—'); continue; }
    res.matched += 1;
    if (seen.has(hit.id)) continue; // bir case bir marta
    seen.add(hit.id);
    const isPaidNow = PAID_STAGES.includes(hit.stage);
    if (r.paid === true) {
      if (isPaidNow) res.alreadyPaid += 1;
      else if (hit.stage === 'INVOICE_CREATED') toPaid.push(hit.id);
      // boshqa bosqich (masalan hali INVOICE yaratilmagan) — o'zgartirmaymiz
    } else if (r.paid === false) {
      if (hit.stage === 'INVOICE_PAID') toUnpaid.push(hit.id);
      else if (!isPaidNow) res.alreadyUnpaid += 1;
    } else {
      res.noStatus += 1;
    }
  }

  res.willMarkPaid = toPaid.length;
  res.willMarkUnpaid = toUnpaid.length;

  // Preview — hech narsa yozmaymiz, faqat sonlar. Tasdiqlangach (apply) yoziladi.
  if (!apply) return res;

  const now = new Date();
  if (toPaid.length) {
    const dueAt = await dueForStage('INVOICE_PAID', now);
    const upd = await prisma.arizaCase.updateMany({ where: { id: { in: toPaid }, stage: 'INVOICE_CREATED', receiptNumber: { not: null } }, data: { stage: 'INVOICE_PAID', stageEnteredAt: now, dueAt } });
    res.markedPaid = upd.count;
  }
  if (toUnpaid.length) {
    const dueAt = await dueForStage('INVOICE_CREATED', now);
    const upd = await prisma.arizaCase.updateMany({ where: { id: { in: toUnpaid }, stage: 'INVOICE_PAID' }, data: { stage: 'INVOICE_CREATED', stageEnteredAt: now, dueAt } });
    res.markedUnpaid = upd.count;
  }
  return res;
}
