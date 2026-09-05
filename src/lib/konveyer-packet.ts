// One-click document packet for a konveyer case: assembles the FULL set of
// forms a client needs — talabnoma (PDF letter), court ariza (.docx),
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
import { firmPrimaryCourt } from './court-routing';
import { loansToAriza, type ArizaFirm } from '@/core/ariza';
import { buildTalabnomaRows, type TalabnomaLoan } from './hippo/talabnoma-excel';
import { renderTalabnomaPdf } from './hippo/talabnoma-pdf';
import { dueForStage } from './konveyer-sla';
import { buildGrafikDocx, isSchedulableLoan } from './grafik-docx';
import { renderOfertaPdf } from './oferta-pdf';

export interface PacketFile { name: string; buf: Buffer }
export interface CasePacket {
  caseId: number;
  folder: string;           // person folder name (e.g. "AXMEDOVA SADOQAT SOLIJON QIZI")
  files: PacketFile[];
  talabnomaMade: boolean;   // talabnoma PDF rendered
  arizaMade: boolean;       // ariza .docx built
  firmId: number | null;    // which firm — so a bulk job can place firm docs once per firm
  firmName: string | null;
}

// Keep apostrophes (straight + Uzbek ʻ and curly) so person folders read like «… OʼGʼLI»,
// not «… O_G_LI». All are valid Windows filename characters.
const safe = (s: string, n = 70) => (s || 'hujjat').replace(/[^\p{L}\p{N}._ ()'ʻ‘’-]+/gu, '_').trim().slice(0, n) || 'hujjat';

// ALLOWLIST — qaysi UPLOADED case-hujjatlari sudga (court packet ZIP) kiritiladi.
// FAQAT ikkitasi: palatada imzolangan ariza skani va xat.hippo UZPOST yetkazish
// kvitansiyasi (talabnoma «check»). BILLING kvitansiyasi (INVOICE — «Почта харажатлари»
// to'lov slipi, billing.sud.uz'да yaratiladi, raqami arizaning ichiga yoziladi) SUDGA
// KETMAYDI; qo'lda yuklangan BOSHQA/istalgan boshqa kind ham ketmaydi. Shu allowlist
// bo'lmasa upload/route.ts orqali qo'lda qo'yilgan invoice/boshqa fayl paketga sizib chiqadi.
const COURT_PACKET_DOC_KINDS = new Set(['SIGNED_ARIZA', 'TALABNOMA_RECEIPT']);

/**
 * Build the packet file list for ONE case. `browser` (a shared Playwright
 * instance) is required to render the talabnoma PDF; omit `talabnomaPdf` (or the
 * browser) to skip the slow PDF step and still get Excel + ariza + firm docs.
 */
export async function buildCasePacket(caseId: number, opts: { browser?: Browser; talabnomaPdf?: boolean; includeFirmDocs?: boolean; includeGrafik?: boolean; arizaOnly?: boolean } = {}): Promise<CasePacket | null> {
  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: {
      pinfl: true, snapshotId: true, kod: true, clientName: true, firmId: true, receiptNumber: true, courtId: true,
      stageEnteredAt: true, batch: { select: { createdAt: true } },
      documents: { select: { kind: true, fileName: true, filePath: true } },
      court: { select: { nameUz: true } },
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

  // DEBT GATE — a fully-paid (or otherwise zero-debt) client×firm has NOTHING to
  // collect, so we generate NO court documents for it (no talabnoma, no ariza, no
  // grafik, no oferta, no invoice). `totalDebt` per loan is exactly
  // debtPrincipal + debtTermInterest + debtOverduePrincipal + debtOverdueInterest
  // (see core/portfolio.computeTotalDebt), so this one sum is the authoritative
  // «Jami qarzdorlik» that both the talabnoma and the ariza would demand — gating on
  // it keeps the two documents consistent (never a talabnoma without an ariza).
  // Already-uploaded case docs (a signed scan, etc.) are still returned below — the
  // gate only suppresses NEW generation; a zero-debt case with no uploads yields an
  // empty packet (no files) and is dropped from the ZIP by the caller.
  const caseDebt = loans.reduce((s, l) => s + (Number((l as { totalDebt?: unknown }).totalDebt) || 0), 0);
  const hasDebt = caseDebt > 0;

  // ARIZA-ONLY — the «Arizani tayyorlash» step builds ONLY the court ariza (one doc
  // per client), because only the ariza is printed and taken to the Sanoat palatasi.
  // Talabnoma / grafik / oferta / invoice / firm docs / prior uploads belong to the
  // Sudga-yuborish packet, not here. `arizaOnly` suppresses every section but the ariza.
  const arizaOnly = opts.arizaOnly === true;

  // 1) Talabnoma — a PDF letter for this client. The Excel «reyestr» is a BULK, many-row
  // file (built per firm in the Talabnoma step / talabnoma-bulk-pdf's `_reyestr.xlsx`), so a
  // one-row per-person .xlsx is NOT emitted here — a single-person reyestr is meaningless
  // and can't be imported to xat.hippo on its own.
  let talabnomaMade = false;
  if (!arizaOnly && hasDebt && loans.length && opts.browser && opts.talabnomaPdf !== false) {
    const rows = buildTalabnomaRows(loans as unknown as TalabnomaLoan[], reportDate);
    if (rows.length) {
      try {
        files.push({ name: `Talabnoma_${folder}.pdf`, buf: await renderTalabnomaPdf(rows[0], opts.browser, firm) });
        talabnomaMade = true;
      } catch { /* PDF render failed — skip the talabnoma for this case */ }
    }
  }

  // 2) Court ariza (.docx) — combined petition for the (client × firm) group.
  let arizaMade = false;
  if (hasDebt && loans.length) {
    const arizaFirm: ArizaFirm = {
      shortName: firm?.shortName || ac.kod || 'Unknown',
      legalName: firm?.legalName ?? null,
      address: firm?.address ?? null,
      bankAccount: firm?.bankAccount ?? null,
      mfo: firm?.mfo ?? null,
      stir: firm?.stir ?? null,
    };
    try {
      // Ariza o'z case'iga biriktirilgan sud nomiga chiqadi (courtId); yo'q bo'lsa firma asosiy sudi.
      const courtName = ac.court?.nameUz ?? (await firmPrimaryCourt(ac.firmId).catch(() => null))?.nameUz;
      const props = loansToAriza(loans, arizaFirm, settings, reportDate, courtName);
      // Skip a void petition: a group whose debt sums to ≤ 0 (e.g. a paid-off client
      // still on the exclusion list) would demand «0 soʻm» — never file that.
      if (Number(props.debtTotal) > 0) {
        // Ariza-only (Arizani tayyorlash): name the file «F.I.O PINFL» so the printed
        // stack is identifiable at a glance; the firm folder is added by the packet job.
        // (ac.kod is the FIRM/branch code, not a client code — it's already the folder, so
        // it isn't repeated here.) Otherwise keep «Ariza_<client>» inside the client folder.
        const arizaName = arizaOnly
          ? `${safe(`${ac.clientName ?? folder} ${ac.pinfl ?? ''}`.replace(/\s+/g, ' ').trim(), 90)}.docx`
          : `Ariza_${folder}.docx`;
        files.push({ name: arizaName, buf: Buffer.from(await buildArizaDocx(props)) });
        arizaMade = true;
      }
    } catch { /* ariza build failed — continue with the rest of the packet */ }
  }

  // 2c) Kredit toʻlash grafigi (.docx) — computed annuity schedule per contract
  // (the portfolio has no month-by-month schedule). The 5th court attachment.
  // Only include when at least one loan is schedulable, else it would be a
  // header-only, schedule-less document.
  // Chronological dates required — a reversed pair would print a bogus 1-month
  // schedule (maturity before disbursement) on a document filed with the court.
  // Grafik is OPTIONAL — the sudga-yuborish (ready) export drops it (includeGrafik:false).
  const grafikLoans = loans.filter(isSchedulableLoan);
  if (!arizaOnly && hasDebt && opts.includeGrafik !== false && grafikLoans.length) {
    try {
      files.push({ name: `Grafik_${folder}.docx`, buf: await buildGrafikDocx(grafikLoans as any, ac.clientName, firm?.shortName || ac.kod || '') });
    } catch { /* grafik build failed — continue */ }
  }

  // 2d) Oferta (mikroqarz shartnomasi) PDF — ONE per loan. The oferta is an UNSIGNED
  // public offer (accepted electronically), so a generated copy is legitimate. Needs
  // the chromium browser (HTML→PDF); term/full-value come from OUR dates → consistent
  // with the grafik. Insurance («таъминот») isn't in the portfolio → 0 until the firm
  // supplies a %/value.
  if (!arizaOnly && hasDebt && opts.browser) {
    let n = 0;
    for (const l of loans) {
      if (Number((l as any).summKr) <= 0) continue; // no amount → no meaningful oferta
      n += 1;
      try {
        const buf = await renderOfertaPdf(l as any, firm ?? {}, opts.browser, ac.clientName, ac.pinfl, 0);
        files.push({ name: `Oferta_${(l as any).ldId ?? n}_${folder}.pdf`, buf });
      } catch { /* skip a failed oferta, keep the rest */ }
    }
  }

  // 2b) Invoice / kvitansiya: DELIBERATELY NOT in the court packet. The state-fee
  // invoice is minted at billing.sud.uz and its NUMBER travels inside the ariza; the
  // invoice PDF/kvitansiya itself does NOT go to court (the ariza stays davlat-bojisiz).
  // The old synthesized Invoice_*.docx "boji form" was removed on purpose — accounting
  // issues no payment report, so nothing invoice-shaped is filed with the court.

  // 3) Firm library docs (guvohnoma / ishonchnoma / shartnoma / oferta). Identical
  // for every client of a firm, so a bulk job passes includeFirmDocs:false and adds
  // them ONCE per firm (avoids duplicating multi-MB scans across thousands of folders).
  // A single-case download keeps them in the folder so the packet stays self-contained.
  // Also debt-gated: a zero-debt case files nothing, so it gets no firm docs either —
  // the single-case download then yields an empty packet («Hujjat shakllanmadi»), and
  // the bulk `_FIRMA/<firm>/` folder is unaffected (it's fed by the firm's debt cases).
  if (!arizaOnly && hasDebt && opts.includeFirmDocs !== false) {
    const firmDocs = await prisma.firmDocument.findMany({ where: { firmId: ac.firmId }, select: { kind: true, label: true, filePath: true } });
    for (const fd of firmDocs) {
      try {
        const buf = await fs.readFile(fd.filePath);
        const ext = path.extname(fd.filePath);
        const label = fd.label || `${fd.kind}${ext}`; // label already carries the extension
        files.push({ name: `${fd.kind}__${safe(label, 50)}`, buf });
      } catch { /* missing file — skip */ }
    }
  }

  // 4) Already-uploaded case docs — FAQAT allowlist (imzolangan ariza skani +
  // xat.hippo UZPOST kvitansiyasi). INVOICE (billing kvitansiya) va qo'lda yuklangan
  // BOSHQA kind'lar ATAYIN o'tkazib yuboriladi — sudga chala/xato data ketmasin.
  if (!arizaOnly) for (const d of ac.documents) {
    if (!COURT_PACKET_DOC_KINDS.has(d.kind)) continue;
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

  return { caseId, folder, files, talabnomaMade, arizaMade, firmId: ac.firmId ?? null, firmName: firm?.shortName ?? ac.kod ?? null };
}

/** Build ONLY the ofertas for one case: one oferta PDF per loan (contract) of the
 *  (client × firm) group. Lean sibling of buildCasePacket for the oferta-only bulk export.
 *  Returns the client folder name + the oferta files, or null when there's nothing to make.
 *  `browser` is required (oferta is HTML→PDF). Failures per loan are swallowed. */
export async function buildCaseOfertas(caseId: number, browser: Browser, insurancePct = 0): Promise<{ folder: string; files: PacketFile[] } | null> {
  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: { pinfl: true, snapshotId: true, kod: true, clientName: true },
  });
  if (!ac?.pinfl || !ac.snapshotId) return null;

  const [firm, loans] = await Promise.all([
    ac.kod ? prisma.firm.findUnique({ where: { code: ac.kod } }) : Promise.resolve(null),
    prisma.loan.findMany({
      where: { snapshotId: ac.snapshotId, pinfl: ac.pinfl, ...(ac.kod ? { branchCode: ac.kod } : {}) },
      orderBy: { id: 'asc' },
    }),
  ]);

  const firmShort = firm?.shortName || ac.kod || 'firma';
  // Group by PINFL: «<FIRM> / <full name> <PINFL>» — two clients sharing a name land in
  // distinct folders, and every oferta is filed under its owner's PINFL (matches the loans path).
  const folder = `${safe(firmShort, 45)}/${safe(`${ac.clientName || `case-${caseId}`} ${ac.pinfl}`.trim(), 90)}`;
  const files: PacketFile[] = [];
  const seen = new Set<string>();
  for (const l of loans) {
    if (Number((l as { summKr?: unknown }).summKr) <= 0) continue; // no amount → no meaningful oferta
    try {
      const buf = await renderOfertaPdf(l as never, firm ?? {}, browser, ac.clientName, ac.pinfl, insurancePct);
      // Dedupe on name — two loans sharing the same (non-null) ldId must NOT overwrite each other in
      // the ZIP (else the download has fewer files than the «Oferta (N)» count). Fall back to the
      // unique loan id on collision.
      let name = `Oferta_${safe(firmShort, 28)}_${(l as { ldId?: string | null }).ldId ?? l.id}.pdf`;
      if (seen.has(name)) name = `Oferta_${safe(firmShort, 28)}_${(l as { ldId?: string | null }).ldId ?? l.id}_${l.id}.pdf`;
      seen.add(name);
      files.push({ name, buf });
    } catch { /* skip a failed oferta, keep the rest */ }
  }
  return files.length ? { folder, files } : null;
}

/** The firm-library files for ONE firm (guvohnoma/ishonchnoma/shartnoma/oferta),
 *  read once — used by a bulk job to place them in a single `_FIRMA/<firm>/` folder
 *  instead of duplicating multi-MB scans into every client folder. */
export async function firmLibraryFiles(firmId: number): Promise<PacketFile[]> {
  const firmDocs = await prisma.firmDocument.findMany({ where: { firmId }, select: { kind: true, label: true, filePath: true } });
  const out: PacketFile[] = [];
  const seen = new Set<string>();
  for (const fd of firmDocs) {
    try {
      const buf = await fs.readFile(fd.filePath);
      const ext = path.extname(fd.filePath);
      let name = `${fd.kind}__${safe(fd.label || `${fd.kind}${ext}`, 50)}`;
      for (let i = 2; seen.has(name); i++) name = `${fd.kind}_${i}__${safe(fd.label || `${fd.kind}${ext}`, 50)}`;
      seen.add(name);
      out.push({ name, buf });
    } catch { /* missing file — skip */ }
  }
  return out;
}

/** Mark the case as generated: flag talabnoma-sent, and move IMPORTED →
 *  ARIZA_GENERATED ONLY when the ariza was actually produced (a case with just
 *  firm docs / prior uploads and no portfolio loans must not advance). */
export async function markPacketGenerated(caseId: number, talabnomaMade: boolean, arizaMade: boolean): Promise<void> {
  if (talabnomaMade) {
    await prisma.arizaCase.updateMany({ where: { id: caseId, talabnomaAt: null }, data: { talabnomaAt: new Date() } });
  }
  if (arizaMade) {
    const now = new Date();
    // Stamp arizaAt (fill-null-only) so a re-run skips already-made arizas — regardless of stage
    // (a case may already be at TALABNOMA_SENT, so the stage transition alone isn't a reliable flag).
    await prisma.arizaCase.updateMany({ where: { id: caseId, arizaAt: null }, data: { arizaAt: now } });
    // Reset the SLA clock for the SIGN phase (else it keeps the stale import
    // deadline and is wrongly flagged overdue on entry).
    const dueAt = await dueForStage('ARIZA_GENERATED', now);
    await prisma.arizaCase.updateMany({
      where: { id: caseId, stage: 'IMPORTED' },
      data: { stage: 'ARIZA_GENERATED', stageEnteredAt: now, dueAt },
    });
  }
}
