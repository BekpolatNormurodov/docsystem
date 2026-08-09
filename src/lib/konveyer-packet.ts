// One-click document packet for a konveyer case: assembles the FULL set of
// forms a client needs — talabnoma (Excel for hippo + PDF), court ariza (.docx),
// the firm's library docs (guvohnoma/ishonchnoma/shartnoma/oferta) and any
// already-uploaded case docs (invoice/receipt/signed ariza) — mirroring the
// manual ZIP that used to be built by hand. Pure builder: returns the file list;
// routes decide how to stream/zip it.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'playwright';
import { prisma } from './db';
import { getSettings } from './settings';
import { buildArizaDocx } from './ariza-docx';
import { loansToAriza, type ArizaFirm } from '@/core/ariza';
import { buildTalabnomaRows, talabnomaExcelBuffer, type TalabnomaLoan } from './hippo/talabnoma-excel';
import { renderTalabnomaPdf } from './hippo/talabnoma-pdf';
import { dueForStage } from './konveyer-sla';
import { buildInvoiceDocx } from './invoice-docx';

export interface PacketFile { name: string; buf: Buffer }
export interface CasePacket {
  caseId: number;
  folder: string;           // person folder name (e.g. "AXMEDOVA SADOQAT SOLIJON QIZI")
  files: PacketFile[];
  talabnomaMade: boolean;   // talabnoma PDF rendered
  arizaMade: boolean;       // ariza .docx built
}

const safe = (s: string, n = 70) => (s || 'hujjat').replace(/[^\p{L}\p{N}._ ()-]+/gu, '_').trim().slice(0, n) || 'hujjat';

/**
 * Build the packet file list for ONE case. `browser` (a shared Playwright
 * instance) is required to render the talabnoma PDF; omit `talabnomaPdf` (or the
 * browser) to skip the slow PDF step and still get Excel + ariza + firm docs.
 */
export async function buildCasePacket(caseId: number, opts: { browser?: Browser; talabnomaPdf?: boolean } = {}): Promise<CasePacket | null> {
  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: {
      pinfl: true, snapshotId: true, kod: true, clientName: true, firmId: true, receiptNumber: true,
      stageEnteredAt: true, batch: { select: { createdAt: true } },
      documents: { select: { kind: true, fileName: true, filePath: true } },
    },
  });
  if (!ac?.pinfl || !ac.snapshotId) return null;

  const [firm, snapshot, settings, loans] = await Promise.all([
    ac.kod ? prisma.firm.findUnique({ where: { code: ac.kod } }) : Promise.resolve(null),
    prisma.snapshot.findUnique({ where: { id: ac.snapshotId } }),
    getSettings(),
    prisma.loan.findMany({
      where: { snapshotId: ac.snapshotId, pinfl: ac.pinfl, ...(ac.kod ? { branchCode: ac.kod } : {}) },
      orderBy: { id: 'asc' },
    }),
  ]);

  const folder = safe(ac.clientName || `case-${caseId}`);
  const files: PacketFile[] = [];
  const reportDate = snapshot?.reportDate ?? new Date();

  // 1) Talabnoma — Excel (hippo import layout) + PDF (rendered).
  let talabnomaMade = false;
  if (loans.length) {
    const rows = buildTalabnomaRows(loans as unknown as TalabnomaLoan[], reportDate);
    if (rows.length) {
      files.push({ name: `Talabnoma_${folder}.xlsx`, buf: await talabnomaExcelBuffer(rows) });
      if (opts.browser && opts.talabnomaPdf !== false) {
        try {
          files.push({ name: `Talabnoma_${folder}.pdf`, buf: await renderTalabnomaPdf(rows[0], opts.browser, firm) });
          talabnomaMade = true;
        } catch { /* PDF render failed — keep the Excel, skip the PDF */ }
      }
    }
  }

  // 2) Court ariza (.docx) — combined petition for the (client × firm) group.
  let arizaMade = false;
  if (loans.length) {
    const arizaFirm: ArizaFirm = {
      shortName: firm?.shortName || ac.kod || 'Unknown',
      legalName: firm?.legalName ?? null,
      address: firm?.address ?? null,
      bankAccount: firm?.bankAccount ?? null,
      mfo: firm?.mfo ?? null,
      stir: firm?.stir ?? null,
    };
    try {
      const props = loansToAriza(loans, arizaFirm, settings, reportDate);
      files.push({ name: `Ariza_${folder}.docx`, buf: Buffer.from(await buildArizaDocx(props)) });
      arizaMade = true;
    } catch { /* ariza build failed — continue with the rest of the packet */ }
  }

  // 2b) Invoice / kvitansiya (.docx) — auto-generated once a receipt is assigned.
  if (ac.receiptNumber) {
    try {
      files.push({ name: `Invoice_${ac.receiptNumber}_${folder}.docx`, buf: await buildInvoiceDocx({ clientName: ac.clientName, kod: ac.kod, receiptNumber: ac.receiptNumber, assignedAt: ac.batch?.createdAt ?? ac.stageEnteredAt, firm }) });
    } catch { /* invoice build failed — continue */ }
  }

  // 3) Firm library docs (one per kind) — guvohnoma / ishonchnoma / shartnoma / oferta.
  const firmDocs = await prisma.firmDocument.findMany({ where: { firmId: ac.firmId }, select: { kind: true, label: true, filePath: true } });
  for (const fd of firmDocs) {
    try {
      const buf = await fs.readFile(fd.filePath);
      const ext = path.extname(fd.filePath);
      const label = fd.label || `${fd.kind}${ext}`; // label already carries the extension
      files.push({ name: `${fd.kind}__${safe(label, 50)}`, buf });
    } catch { /* missing file — skip */ }
  }

  // 4) Already-uploaded case docs (invoice / receipt / signed scan).
  for (const d of ac.documents) {
    try {
      const buf = await fs.readFile(d.filePath);
      files.push({ name: `${d.kind}__${safe(d.fileName, 50)}`, buf });
    } catch { /* missing file — skip */ }
  }

  // Dedupe file names — two docs that sanitize to the same name would silently
  // overwrite each other in the ZIP (e.g. two null-label «shartnoma» firm docs),
  // dropping a document from the court packet with no error.
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.name)) {
      const dot = f.name.lastIndexOf('.');
      const base = dot > 0 ? f.name.slice(0, dot) : f.name;
      const ext = dot > 0 ? f.name.slice(dot) : '';
      let i = 2;
      while (seen.has(`${base} (${i})${ext}`)) i++;
      f.name = `${base} (${i})${ext}`;
    }
    seen.add(f.name);
  }

  return { caseId, folder, files, talabnomaMade, arizaMade };
}

/** Mark the case as generated: flag talabnoma-sent, and move IMPORTED →
 *  ARIZA_GENERATED ONLY when the ariza was actually produced (a case with just
 *  firm docs / prior uploads and no portfolio loans must not advance). */
export async function markPacketGenerated(caseId: number, talabnomaMade: boolean, arizaMade: boolean): Promise<void> {
  if (talabnomaMade) {
    await prisma.arizaCase.updateMany({ where: { id: caseId, talabnomaAt: null }, data: { talabnomaAt: new Date() } });
  }
  if (arizaMade) {
    // Reset the SLA clock for the SIGN phase (else it keeps the stale import
    // deadline and is wrongly flagged overdue on entry).
    const now = new Date();
    const dueAt = await dueForStage('ARIZA_GENERATED', now);
    await prisma.arizaCase.updateMany({
      where: { id: caseId, stage: 'IMPORTED' },
      data: { stage: 'ARIZA_GENERATED', stageEnteredAt: now, dueAt },
    });
  }
}
