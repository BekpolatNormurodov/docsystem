// Palatadan qaytgan IMZOLANGAN skan → har bir mijozning ARIZASINI ALOHIDA PDF
// qilib ajratib, uni case'iga SIGNED_ARIZA hujjati sifatida BAZAGA (CaseDocument)
// bogʻlaydi. Shu bilan imzolangan ariza sud paketiga (buildCasePacket) avtomat
// kiradi va case SIGNED_SCANNED bosqichiga oʻtadi. Migratsiya SHART EMAS — mavjud
// CaseDocument jadvali + exports/case-docs/{caseId}/ ishlatiladi. Idempotent:
// case allaqachon imzolangan skanni saqlagan boʻlsa — qayta ajratmaydi.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { prisma } from './db';
import { dueForStage } from './konveyer-sla';
import { SCAN_STORE } from './palata-ocr';
import { readScannedArizas } from './palata-scan';

const DOCS = path.join(process.cwd(), 'exports', 'case-docs');
const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);
const STAGE_ORDER = ['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];

// Only the fields the attach step needs — so both ScannedAriza and ScannedArizaFull
// (and the panel's rows) are accepted without a cast.
export interface AttachInput { pinfl: string; source?: string; firmKey: string; pages: string; name: string }

/** Extract a page range ("N-M", 1-indexed) from an already-loaded scan PDF into a
 *  fresh single-client document. Falls back to the whole file when the range is
 *  missing/unparsable. Takes a pre-loaded PDFDocument so a big multi-client scan is
 *  read once even when many clients are split out of it. */
export async function extractPagesPdf(src: PDFDocument, pages: string | null | undefined): Promise<Buffer> {
  const out = await PDFDocument.create();
  const count = src.getPageCount();
  const m = /^(\d+)-(\d+)$/.exec(pages || '');
  let idxs: number[];
  if (m) { const a = Math.max(1, Number(m[1])), b = Math.min(count, Number(m[2])); idxs = []; for (let p = a; p <= b; p++) idxs.push(p - 1); }
  else idxs = src.getPageIndices();
  const copied = await out.copyPages(src, idxs);
  copied.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}

/** Same, reading the source scan from disk (used by the per-client download route). */
export async function extractPagesPdfFromFile(file: string, pages: string | null | undefined): Promise<Buffer> {
  const src = await PDFDocument.load(await fsp.readFile(file));
  return extractPagesPdf(src, pages);
}

type FirmLite = { id: number; code: string | null; shortName: string };
// The scan's firmKey (BRIGHT/URBAN/…) → the firm whose shortName contains it, the
// same rule palataScanSummary uses so linked cases match the panel's firm buckets.
function resolveFirmId(firmKey: string, firms: FirmLite[]): number | null {
  const key = (firmKey || '').toUpperCase();
  if (!key) return null;
  return firms.find((x) => (x.shortName || '').toUpperCase().includes(key))?.id ?? null;
}

export interface AttachResult {
  total: number;    // scanned arizas considered (with a pinfl + retained source)
  linked: number;   // NEW signed-ariza PDFs split out and saved to a case this run
  updated: number;  // existing signed-ariza docs REPLACED with a fresh scan (update mode)
  already: number;  // case already had a signed-ariza doc — left as is
  advanced: number; // cases moved to SIGNED_SCANNED
  noCase: number;   // firm matched but no pipeline case (or a split/write failed)
  noMatch: number;  // firm couldn't be resolved and the pinfl wasn't a unique case
}

export interface AttachOpts {
  onProgress?: (done: number, total: number) => void;
  // PINFLs whose ALREADY-saved case doc should be REPLACED with the fresh scan
  // («mavjudlarni yangilash»). A case with a doc whose pinfl isn't here is left as
  // is (counted `already`). Omit → nothing is overwritten (pure catch-up).
  replacePinfls?: Set<string>;
}

/**
 * Split every scanned ariza into its own signed-ariza PDF and attach it to the
 * matching case (pinfl × firm) as a CaseDocument(SIGNED_ARIZA), advancing the case
 * to SIGNED_SCANNED. Idempotent — a case that already carries a signed-ariza doc is
 * left untouched UNLESS its pinfl is in `replacePinfls`, in which case the old doc is
 * replaced with the fresh scan. Groups by source scan so each big PDF is read once.
 * Never throws per-item; a failure drops that ariza to the noCase bucket.
 */
export async function attachScannedArizas(arizas: AttachInput[], opts: AttachOpts = {}): Promise<AttachResult> {
  const { onProgress, replacePinfls } = opts;
  const res: AttachResult = { total: 0, linked: 0, updated: 0, already: 0, advanced: 0, noCase: 0, noMatch: 0 };
  const items = arizas.filter((a) => a.pinfl && a.source);
  res.total = items.length;
  if (items.length === 0) { onProgress?.(0, 0); return res; }

  const pinfls = [...new Set(items.map((a) => a.pinfl))];
  const [firms, cases] = await Promise.all([
    prisma.firm.findMany({ select: { id: true, code: true, shortName: true } }),
    prisma.arizaCase.findMany({ where: { pinfl: { in: pinfls } }, select: { id: true, pinfl: true, firmId: true, stage: true }, orderBy: { id: 'asc' } }),
  ]);

  // (pinfl::firmId) → latest case (orderBy id asc, last write wins); pinfl → all its
  // cases (for the single-case fallback when the scan's firm can't be resolved).
  const caseByPair = new Map<string, { id: number; stage: string }>();
  const casesByPinfl = new Map<string, { id: number; stage: string }[]>();
  for (const c of cases) {
    if (!c.pinfl) continue;
    caseByPair.set(`${c.pinfl}::${c.firmId}`, { id: c.id, stage: c.stage });
    const arr = casesByPinfl.get(c.pinfl) ?? [];
    arr.push({ id: c.id, stage: c.stage });
    casesByPinfl.set(c.pinfl, arr);
  }

  // Cases that already carry a signed-ariza doc → their existing files (so a replace
  // can delete the old PDF before writing the new one).
  const caseIds = cases.map((c) => c.id);
  const existing = caseIds.length
    ? await prisma.caseDocument.findMany({ where: { caseId: { in: caseIds }, kind: 'SIGNED_ARIZA' }, select: { id: true, caseId: true, filePath: true } })
    : [];
  const docsByCase = new Map<number, { id: number; filePath: string }[]>();
  for (const d of existing) {
    const arr = docsByCase.get(d.caseId) ?? [];
    arr.push({ id: d.id, filePath: d.filePath });
    docsByCase.set(d.caseId, arr);
  }

  // Resolve the target case for each ariza up front so we can group by source scan.
  type Target = { a: AttachInput; caseId: number; stage: string; replace: boolean };
  const toSplit: Target[] = [];
  let done = 0;
  const total = items.length;
  onProgress?.(0, total);
  for (const a of items) {
    const fid = resolveFirmId(a.firmKey, firms);
    let target = fid != null ? caseByPair.get(`${a.pinfl}::${fid}`) ?? null : null;
    if (!target) {
      // Firm not detected / no case at that firm — fall back to a UNIQUE case for the pinfl.
      const list = casesByPinfl.get(a.pinfl) ?? [];
      if (list.length === 1) target = list[0];
    }
    if (!target) { if (fid != null) res.noCase++; else res.noMatch++; done++; continue; }
    if (docsByCase.has(target.id)) {
      // Already saved — replace only when the user asked to update this pinfl.
      if (replacePinfls?.has(a.pinfl)) toSplit.push({ a, caseId: target.id, stage: target.stage, replace: true });
      else { res.already++; done++; }
      continue;
    }
    toSplit.push({ a, caseId: target.id, stage: target.stage, replace: false });
  }
  onProgress?.(done, total);

  // Group the ones that need splitting by their source scan so each PDF loads once.
  const grouped = new Map<string, Target[]>();
  for (const t of toSplit) {
    const s = t.a.source!;
    const arr = grouped.get(s) ?? [];
    arr.push(t);
    grouped.set(s, arr);
  }

  for (const [source, group] of grouped) {
    const file = path.join(SCAN_STORE, path.basename(source));
    let srcDoc: PDFDocument | null = null;
    try { srcDoc = await PDFDocument.load(await fsp.readFile(file)); } catch { srcDoc = null; }
    for (const t of group) {
      try {
        if (!srcDoc) throw new Error('scan yoʻq');
        if (t.replace) {
          // Drop the old signed-ariza doc(s) — file + row — before writing the fresh one.
          for (const d of docsByCase.get(t.caseId) ?? []) await fsp.rm(d.filePath, { force: true }).catch(() => {});
          await prisma.caseDocument.deleteMany({ where: { caseId: t.caseId, kind: 'SIGNED_ARIZA' } });
        } else {
          // Guard against a concurrent attach (OCR phase-2 + a manual catch-up).
          const dup = await prisma.caseDocument.findFirst({ where: { caseId: t.caseId, kind: 'SIGNED_ARIZA' }, select: { id: true } });
          if (dup) { res.already++; continue; }
        }
        const buf = await extractPagesPdf(srcDoc, t.a.pages);
        const dir = path.join(DOCS, String(t.caseId));
        await fsp.mkdir(dir, { recursive: true });
        const fileName = `${safe(t.a.name || t.a.pinfl) || 'imzolangan-ariza'}.pdf`;
        const dest = path.join(dir, `${Date.now()}-${safe(fileName)}`);
        await fsp.writeFile(dest, buf);
        await prisma.caseDocument.create({ data: { caseId: t.caseId, kind: 'SIGNED_ARIZA', fileName, filePath: dest, size: buf.length } });
        if (t.replace) res.updated++; else res.linked++;
        // Advance to SIGNED_SCANNED when the case is behind (working-day deadline).
        if (STAGE_ORDER.indexOf(t.stage) < STAGE_ORDER.indexOf('SIGNED_SCANNED')) {
          const now = new Date();
          await prisma.arizaCase.update({ where: { id: t.caseId }, data: { stage: 'SIGNED_SCANNED', stageEnteredAt: now, dueAt: await dueForStage('SIGNED_SCANNED', now) } }).catch(() => {});
          res.advanced++;
        }
      } catch {
        res.noCase++; // split/write/db failure — leave it unlinked, keep going
      } finally {
        done++;
        onProgress?.(done, total);
      }
    }
  }
  return res;
}

/** Catch-up: attach every ariza currently in the palata dataset to its case
 *  (idempotent). Used by the OCR job's phase 2 and the «Bazaga saqlash» button.
 *  `replacePinfls` overwrites the given clients' already-saved docs («yangilash»). */
export async function attachAllScanned(opts: AttachOpts = {}): Promise<AttachResult> {
  return attachScannedArizas(readScannedArizas(), opts);
}
