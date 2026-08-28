// Background "Tayyorlash": generate the FULL court packet (Talabnoma xlsx+pdf,
// Ariza, Grafik, Invoice, firm docs, uploads) for EVERY case in scope and stream
// them into one ZIP (a folder per person) at exports/{jobId}.zip. Fire-and-forget
// from the route — progress/state live on the Job row, so the operator presses
// «Tayyorlash» once instead of generating case-by-case.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import archiver from 'archiver';
import type { Browser } from 'playwright';
import type { CaseStage } from '@prisma/client';
import { prisma } from './db';
import { buildCasePacket, buildCaseOfertas, markPacketGenerated, firmLibraryFiles } from './konveyer-packet';
import { markCasesExported } from './court-ready';
import { renderOfertaPdf } from './oferta-pdf';
import { loadTalabnomaRowsForScope, type TalabnomaScope } from './hippo/talabnoma-bulk';
import { renderTalabnomaPdf } from './hippo/talabnoma-pdf';
import { talabnomaExcelBuffer } from './hippo/talabnoma-excel';

const EXPORTS_DIR = path.join(process.cwd(), 'exports');

// Export ZIP retention — these files (ariza/oferta/packet ZIPs) accumulate forever and once filled a
// 14 GB disk, which blocked every job (no space to write). Before each new export we prune: drop ZIPs
// older than EXPORT_MAX_AGE, then, if the total still exceeds EXPORT_MAX_TOTAL, delete oldest-first
// until under the cap. Best-effort — never throws, never blocks the job. History rows for a pruned ZIP
// simply 404 on download (the work is regenerable); the size cap is what keeps the disk safe.
const EXPORT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 kun
const EXPORT_MAX_TOTAL = 4 * 1024 * 1024 * 1024;   // 4 GB jami
async function pruneOldExports(): Promise<void> {
  try {
    const names = await fsp.readdir(EXPORTS_DIR).catch(() => [] as string[]);
    const now = Date.now();
    const files: { path: string; size: number; mtime: number }[] = [];
    for (const name of names) {
      if (!name.endsWith('.zip')) continue;
      const p = path.join(EXPORTS_DIR, name);
      const st = await fsp.stat(p).catch(() => null);
      if (st?.isFile()) files.push({ path: p, size: st.size, mtime: st.mtimeMs });
    }
    let total = 0;
    const kept: typeof files = [];
    for (const f of files) {
      if (now - f.mtime > EXPORT_MAX_AGE_MS) await fsp.unlink(f.path).catch(() => {});
      else { kept.push(f); total += f.size; }
    }
    kept.sort((a, b) => a.mtime - b.mtime); // eng eski birinchi
    for (const f of kept) {
      if (total <= EXPORT_MAX_TOTAL) break;
      await fsp.unlink(f.path).catch(() => {});
      total -= f.size;
    }
  } catch { /* best-effort — tozalash job'ni to'xtatmaydi */ }
}

// How many chromium pages render in parallel per batch. Each open page ≈ one CPU-bound render, so on a
// big-CPU backend raise WORKER_CONCURRENCY (e.g. 8–16) to render packets/ofertas/talabnomas much faster;
// it also raises peak chromium RAM, so give the worker container matching memory + /dev/shm. Default 5.
const PDF_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 5);

/** Per-batch checkpoint: did the operator request «Bekor» on this job? One tiny indexed read per
 *  render batch (batches are seconds apart under chromium), so the added cost is negligible. When it
 *  returns true the loop stops rendering and BREAKS — the archive is still finalized, so whatever was
 *  produced so far is KEPT as a downloadable ZIP (a cancel must not throw away finished work). */
async function cancelRequested(jobId: number): Promise<boolean> {
  const j = await prisma.job.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
  return j?.cancelRequested === true;
}

export interface PacketJobOpts {
  snapshotId?: number;
  firmId?: number;
  stages?: CaseStage[];
  talabnomaPdf?: boolean; // include the (slow) rendered talabnoma PDF
  caseIds?: number[];     // explicit case list (sudga-yuborish) — overrides snapshot/firm/stages
  includeGrafik?: boolean; // default true; ready-export passes false («grafik yoq»)
  markExported?: boolean;  // stamp meta.exportedAt on the produced cases when done
  limit?: number;          // «belgilangan son» — build only the first N cases of the scope (0/omitted → all)
  arizaOnly?: boolean;     // «Arizani tayyorlash» — ONLY the ariza per client (no talabnoma/oferta/firm docs)
}

/** Runs a bulk packet job to completion. Never throws — failures are recorded on
 *  the Job row so the fire-and-forget caller needs no catch. */
export async function runPacketJob(jobId: number, opts: PacketJobOpts): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });
  const arizaOnly = opts.arizaOnly === true;
  // Ariza-only needs no chromium (ariza is a .docx) — force the PDF/browser off.
  const withPdf = !arizaOnly && opts.talabnomaPdf !== false;
  let browser: Browser | null = null;
  let output: fs.WriteStream | null = null;
  const zipPath = path.join(EXPORTS_DIR, `${jobId}.zip`);
  try {
    // Explicit case list (sudga-yuborish) wins; otherwise the scope query.
    let caseIds: number[];
    if (opts.caseIds && opts.caseIds.length) {
      caseIds = opts.caseIds;
    } else {
      const rows = await prisma.arizaCase.findMany({
        where: {
          ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}),
          ...(opts.firmId ? { firmId: opts.firmId } : {}),
          ...(opts.stages && opts.stages.length ? { stage: { in: opts.stages } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      caseIds = rows.map((r) => r.id);
    }
    // «Belgilangan son» — build only the first N of the scope (ordered by id for a stable slice).
    if (opts.limit && opts.limit > 0 && opts.limit < caseIds.length) caseIds = caseIds.slice(0, opts.limit);

    await fsp.mkdir(EXPORTS_DIR, { recursive: true });
    await pruneOldExports(); // eski/ortiqcha ZIP'larni tozalab, yangi yozishga joy ochamiz
    output = fs.createWriteStream(zipPath);
    const out = output; // non-null local
    // store: true → no DEFLATE. Every payload here (chromium PDFs, xlsx, docx) is already
    // compressed, so deflating them again is pure CPU waste that competes with the parallel
    // renders for cores. Storing keeps the ZIP ~the same size and frees CPU for rendering.
    const archive = archiver('zip', { store: true });
    // A fatal destination error (ENOSPC/EBUSY) is captured out-of-band so the append
    // loop can abort at the next iteration instead of feeding a dead sink (which would
    // make archiver buffer every remaining entry in memory → OOM, leaving Job stuck RUNNING).
    let streamErr: Error | null = null;
    const closed = new Promise<void>((resolve, reject) => {
      out.on('close', resolve);
      out.on('error', (e) => { streamErr = e; reject(e); });
      archive.on('error', (e) => { streamErr = e; reject(e); });
    });
    // A stream error can reject `closed` on a teardown path that never awaits it (an early throw
    // jumps past `await closed`) → an unhandledRejection that crashes the process. A no-op handler
    // makes the rejection always-handled; the real `await closed` still surfaces it on the happy path.
    closed.catch(() => {});
    archive.pipe(out);

    // Chromium renders the OFERTAS (one per contract) AND the optional talabnoma PDF — a FULL packet
    // (not arizaOnly) ALWAYS needs it, even when the talabnoma PDF is turned off (else every packet
    // silently ships without ofertas). A launch failure must NOT discard the whole batch; the
    // ariza/grafik/invoice/firm docs need no browser.
    if (!arizaOnly) {
      try { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true }); }
      catch (e) { console.error('prepare-packets: chromium launch failed — continuing without PDF/oferta', e); browser = null; }
    }

    const usedFolders = new Set<string>();
    const usedArizaPaths = new Set<string>(); // ariza-only: dedupe the flat «firma/file» paths
    const toMark: { id: number; talabnomaMade: boolean; arizaMade: boolean }[] = [];
    // Firm library docs are identical for every client of a firm, so collect the
    // firms seen and add each firm's docs ONCE (to `_FIRMA/<firm>/`) after the loop —
    // instead of duplicating multi-MB scans into all thousands of client folders.
    const firmsSeen = new Map<number, string>();
    let done = 0;
    let canceled = false; // «Bekor» → break the loop, keep+finalize what's built so far
    // Chromium PDF rendering (talabnoma + per-loan oferta) dominates the wall clock, so
    // BUILD cases in concurrent batches — up to CONCURRENCY buildCasePacket calls in
    // flight, each holding at most one chromium page → ≤CONCURRENCY pages open at once.
    // The ZIP APPEND stays single-threaded per batch (archiver is not concurrency-safe and
    // the entry order must be deterministic). ~CONCURRENCY× faster with flat memory.
    const CONCURRENCY = PDF_CONCURRENCY;
    for (let i = 0; i < caseIds.length; i += CONCURRENCY) {
      if (streamErr) throw streamErr; // sink died (disk full/locked) → abort before spawning more work
      if (await cancelRequested(jobId)) { canceled = true; break; } // «Bekor» → stop; keep what's built
      const batch = caseIds.slice(i, i + CONCURRENCY);
      // Only a per-CASE failure (bad data, doc build) is swallowed here; a sink error is not.
      const packets = await Promise.all(
        batch.map((id) =>
          buildCasePacket(id, { browser: browser ?? undefined, talabnomaPdf: withPdf, includeFirmDocs: false, includeGrafik: opts.includeGrafik, arizaOnly })
            .catch(() => null), // skip a failed case, keep the rest of the batch
        ),
      );
      for (let k = 0; k < packets.length; k++) {
        if (streamErr) throw streamErr;
        const id = batch[k];
        const p = packets[k];
        if (p && p.files.length) {
          if (arizaOnly) {
            // «Arizani tayyorlash» — one ariza per client, grouped by FIRM folder, named
            // «F.I.O PINFL kod». No per-client subfolder (each client is a single file).
            const firmDir = safeName(p.firmName || `firma-${p.firmId}`, 60);
            for (const f of p.files) {
              let full = `${firmDir}/${f.name}`;
              if (usedArizaPaths.has(full)) {
                const dot = f.name.lastIndexOf('.');
                const base = dot > 0 ? f.name.slice(0, dot) : f.name;
                const ext = dot > 0 ? f.name.slice(dot) : '';
                let j = 2; while (usedArizaPaths.has(`${firmDir}/${base} (${j})${ext}`)) j++;
                full = `${firmDir}/${base} (${j})${ext}`;
              }
              usedArizaPaths.add(full);
              archive.append(f.buf, { name: full });
            }
          } else {
            let folder = p.folder;
            for (let j = 2; usedFolders.has(folder); j++) folder = `${p.folder} (${j})`;
            usedFolders.add(folder);
            for (const f of p.files) archive.append(f.buf, { name: `${folder}/${f.name}` });
          }
          if (p.firmId != null && !firmsSeen.has(p.firmId)) firmsSeen.set(p.firmId, p.firmName || `firma-${p.firmId}`);
          // Backpressure → memory stays flat at any scale. Outside the per-case catch so a
          // sink error rejecting here propagates to the outer catch (clean FAILED), not swallowed.
          if (out.writableNeedDrain) await once(out, 'drain');
          toMark.push({ id, talabnomaMade: p.talabnomaMade, arizaMade: p.arizaMade });
        }
        done += 1;
      }
      await prisma.job.updateMany({ where: { id: jobId }, data: { progress: done } }).catch(() => {});
    }

    // Firm library docs — once per firm at the ZIP root (`_FIRMA/<firm>/`), so a firm's
    // guvohnoma/ishonchnoma/shartnoma/oferta isn't copied into every client folder.
    // Ariza-only: firm docs belong to the court packet, not this step — skip them.
    if (!arizaOnly) for (const [fid, fname] of firmsSeen) {
      if (streamErr) throw streamErr;
      const libFiles = await firmLibraryFiles(fid).catch(() => []);
      const dir = `_FIRMA/${fname.replace(/[^\p{L}\p{N}._ ()-]+/gu, '_').trim().slice(0, 60) || `firma-${fid}`}`;
      for (const f of libFiles) archive.append(f.buf, { name: `${dir}/${f.name}` });
      if (out.writableNeedDrain) await once(out, 'drain');
    }

    await archive.finalize();
    await closed;

    // ZIP is on disk. On a clean finish advance the cases (idempotent). On «Bekor» we KEEP the partial
    // ZIP for download but do NOT advance the funnel — a cancelled run must not mark work as done.
    if (!canceled) {
      for (const m of toMark) await markPacketGenerated(m.id, m.talabnomaMade, m.arizaMade).catch(() => {});
      // Sudga-yuborish: stamp exportedAt so «chiqarilganlar» counters exclude them next time.
      if (opts.markExported) await markCasesExported(toMark.map((m) => m.id)).catch(() => {});
    }

    // Recorded count = files ACTUALLY written, not cases processed. A 0-debt case is legitimately
    // skipped (no «0 soʻm» petition) and produces no file, so counting processed cases inflated the
    // «N ariza» label (history showed «5 ariza» for a ZIP that held 2). Use the real written count.
    const writtenCount = arizaOnly ? usedArizaPaths.size : usedFolders.size;
    await prisma.job.updateMany({
      where: { id: jobId },
      data: canceled
        ? { status: 'CANCELED', progress: writtenCount, total: writtenCount, resultPath: `exports/${jobId}.zip`, message: `Bekor qilindi — ${writtenCount} ta tayyor`, cancelRequested: false }
        : { status: 'DONE', progress: writtenCount, total: writtenCount, resultPath: `exports/${jobId}.zip` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message } }).catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (output && !output.closed) output.destroy(); // never leak the write-stream FD on a mid-run throw
  }
}

// Keep apostrophes (straight + Uzbek ʻ and curly) so client folders read exactly like the
// operator's own — «ABDUGʼANIYEV … OʼGʼLI», not «ABDUG_ANIYEV … O_G_LI». All are valid on Windows.
const safeName = (s: string, n = 70) => (s || 'hujjat').replace(/[^\p{L}\p{N}._ ()'ʻ‘’-]+/gu, '_').trim().slice(0, n) || 'hujjat';

/** Background «Oferta» job over an EXPLICIT loan-id list (loan-level, not case-level) —
 *  used to render the ofertas for a hand-picked set of clients (e.g. a court list built off
 *  loans, which may include people with no arizaCase). One oferta per loan, grouped by client
 *  folder, one shared browser. Same streaming/backpressure guarantees as the other jobs. */
export async function runOfertaJobByLoans(jobId: number, loanIds: number[], insurancePct = 0): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });
  let browser: Browser | null = null;
  let output: fs.WriteStream | null = null;
  const zipPath = path.join(EXPORTS_DIR, `${jobId}.zip`);
  try {
    const loans = await prisma.loan.findMany({ where: { id: { in: loanIds } }, orderBy: [{ clientName: 'asc' }, { id: 'asc' }] });
    const codes = [...new Set(loans.map((l) => l.branchCode).filter((c): c is string => !!c))];
    const firms = await prisma.firm.findMany({ where: { code: { in: codes } } });
    const firmByCode = new Map(firms.map((f) => [f.code, f]));

    await fsp.mkdir(EXPORTS_DIR, { recursive: true });
    await pruneOldExports(); // eski/ortiqcha ZIP'larni tozalab, yangi yozishga joy ochamiz
    output = fs.createWriteStream(zipPath);
    const out = output;
    const archive = archiver('zip', { store: true });
    let streamErr: Error | null = null;
    const closed = new Promise<void>((resolve, reject) => {
      out.on('close', resolve);
      out.on('error', (e) => { streamErr = e; reject(e); });
      archive.on('error', (e) => { streamErr = e; reject(e); });
    });
    // A stream error can reject `closed` on a teardown path that never awaits it (an early throw
    // jumps past `await closed`) → an unhandledRejection that crashes the process. A no-op handler
    // makes the rejection always-handled; the real `await closed` still surfaces it on the happy path.
    closed.catch(() => {});
    archive.pipe(out);

    try { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true }); }
    catch (e) { throw new Error(`chromium launch failed: ${e instanceof Error ? e.message : String(e)}`); }

    const usedPaths = new Set<string>();
    let done = 0;
    let canceled = false; // «Bekor» → break the loop, keep+finalize what's built so far
    const CONCURRENCY = PDF_CONCURRENCY;
    for (let i = 0; i < loans.length; i += CONCURRENCY) {
      if (streamErr) throw streamErr;
      if (await cancelRequested(jobId)) { canceled = true; break; } // «Bekor» → stop; keep what's built
      const batch = loans.slice(i, i + CONCURRENCY);
      const rendered = await Promise.all(batch.map(async (l) => {
        if (Number(l.summKr) <= 0) return null;
        const firm = l.branchCode ? firmByCode.get(l.branchCode) ?? null : null;
        try {
          const buf = await renderOfertaPdf(l as never, firm ?? {}, browser as Browser, l.clientName, l.pinfl, insurancePct);
          // 3-level layout: «<FIRM> / <full name> <PINFL> / oferta_<ld_id>.pdf». A client with
          // contracts in several firms appears under each firm folder (that firm's contracts only).
          const firmShort = firm?.shortName || l.branchCode || 'firma';
          const client = safeName(`${l.clientName || `loan-${l.id}`} ${l.pinfl ?? ''}`.trim(), 90);
          const folder = `${safeName(firmShort, 45)}/${client}`;
          return { folder, name: `oferta_${safeName(String(l.ldId ?? l.id), 40)}.pdf`, buf };
        } catch { return null; }
      }));
      for (const r of rendered) {
        if (streamErr) throw streamErr;
        if (r) {
          let full = `${r.folder}/${r.name}`;
          if (usedPaths.has(full)) {
            const dot = r.name.lastIndexOf('.');
            const base = dot > 0 ? r.name.slice(0, dot) : r.name;
            const ext = dot > 0 ? r.name.slice(dot) : '';
            let k = 2; while (usedPaths.has(`${r.folder}/${base} (${k})${ext}`)) k++;
            full = `${r.folder}/${base} (${k})${ext}`;
          }
          usedPaths.add(full);
          archive.append(r.buf, { name: full });
          if (out.writableNeedDrain) await once(out, 'drain');
        }
        done += 1;
      }
      await prisma.job.updateMany({ where: { id: jobId }, data: { progress: done, message: `${usedPaths.size} oferta / ${done} loan` } }).catch(() => {});
    }

    await archive.finalize();
    await closed;
    await prisma.job.updateMany({
      where: { id: jobId },
      // «Bekor» keeps the partial ZIP (downloadable) and reports CANCELED — never discards finished work.
      data: canceled
        ? { status: 'CANCELED', progress: done, total: done, resultPath: `exports/${jobId}.zip`, message: `Bekor qilindi — ${usedPaths.size} oferta`, cancelRequested: false }
        : { status: 'DONE', progress: done, total: done, resultPath: `exports/${jobId}.zip`, message: `${usedPaths.size} oferta` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message } }).catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (output && !output.closed) output.destroy();
  }
}

/** Background «Talabnoma» job: render ONLY the talabnoma letters — one PDF per client — for one
 *  firm × one snapshot, streamed into a flat ZIP with the reyestr `_reyestr.xlsx` at the root (so
 *  one download carries both the letters and the hippo import file). Chromium is REQUIRED (HTML→PDF),
 *  so a launch failure fails the job. Same streaming/backpressure pattern as runOfertaJob; never
 *  throws — the outcome is recorded on the Job row. On success it advances the talabnoma track
 *  (talabnomaAt) for the firm's debt>0 clients — the reyestr set — matching the single-case routes. */
export async function runTalabnomaJob(jobId: number, opts: TalabnomaScope, singleCase = false): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });
  let browser: Browser | null = null;
  let output: fs.WriteStream | null = null;
  const zipPath = path.join(EXPORTS_DIR, `${jobId}.zip`);
  try {
    const { rows, firm, paidPinfls } = await loadTalabnomaRowsForScope(opts);
    if (rows.length === 0) throw new Error('Talabnoma qatori yoʻq (qarzdorlik 0 yoki maʼlumot yoʻq)');

    await fsp.mkdir(EXPORTS_DIR, { recursive: true });
    await pruneOldExports(); // eski/ortiqcha ZIP'larni tozalab, yangi yozishga joy ochamiz
    output = fs.createWriteStream(zipPath);
    const out = output;
    const archive = archiver('zip', { store: true });
    let streamErr: Error | null = null;
    const closed = new Promise<void>((resolve, reject) => {
      out.on('close', resolve);
      out.on('error', (e) => { streamErr = e; reject(e); });
      archive.on('error', (e) => { streamErr = e; reject(e); });
    });
    // A stream error can reject `closed` on a teardown path that never awaits it (an early throw
    // jumps past `await closed`) → an unhandledRejection that crashes the process. A no-op handler
    // makes the rejection always-handled; the real `await closed` still surfaces it on the happy path.
    closed.catch(() => {});
    archive.pipe(out);

    // Reyestr Excel first — the hippo import file the whole batch exists to produce. Its failure is
    // FATAL: a ZIP without it is useless, so a throw here fails the job (→ FAILED, no funnel advance)
    // rather than silently shipping a green download that is missing the import file. A single-case
    // talabnoma (one client) has no reyestr to import, so its ZIP is just the one letter PDF.
    if (!singleCase) archive.append(await talabnomaExcelBuffer(rows), { name: '_reyestr.xlsx' });

    try { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true }); }
    catch (e) { throw new Error(`chromium launch failed: ${e instanceof Error ? e.message : String(e)}`); }

    const usedNames = new Set<string>();
    let done = 0;
    let canceled = false; // «Bekor» → break the loop, keep+finalize what's built so far
    const CONCURRENCY = PDF_CONCURRENCY;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (streamErr) throw streamErr;
      if (await cancelRequested(jobId)) { canceled = true; break; } // «Bekor» → stop; keep what's built
      const batch = rows.slice(i, i + CONCURRENCY);
      const rendered = await Promise.all(batch.map(async (row) => {
        try {
          const buf = await renderTalabnomaPdf(row, browser as Browser, firm);
          const name = `${row.contract_id.replace(/\//g, '-')}_${safeName(row.receiver, 60)}.pdf`;
          return { name, buf };
        } catch { return null; }
      }));
      for (const r of rendered) {
        if (streamErr) throw streamErr;
        if (r) {
          let name = r.name;
          if (usedNames.has(name)) {
            const dot = name.lastIndexOf('.');
            const base = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : '';
            let k = 2; while (usedNames.has(`${base} (${k})${ext}`)) k++;
            name = `${base} (${k})${ext}`;
          }
          usedNames.add(name);
          archive.append(r.buf, { name });
          if (out.writableNeedDrain) await once(out, 'drain');
        }
        done += 1;
      }
      await prisma.job.updateMany({ where: { id: jobId }, data: { progress: done, message: `${usedNames.size} talabnoma / ${done} mijoz` } }).catch(() => {});
    }

    // FIX 1 (single-case data integrity): a per-letter render failure is swallowed above (~the catch in
    // the batch map), so a single-case job whose only letter failed would otherwise finalize an EMPTY
    // ZIP, stamp talabnomaAt, and be marked DONE — the funnel would falsely advance and the route would
    // stream an empty 200. There is no reyestr to fall back on for a single case (skipped above), so a
    // zero-render single case has produced NOTHING deliverable. THROW before finalize → the catch marks
    // the job FAILED (route returns 500) and talabnomaAt is never stamped. Bulk (singleCase false) is
    // deliberately untouched: its reyestr guarantees delivery, so its existing marking stays correct.
    if (singleCase && usedNames.size === 0) {
      throw new Error('Talabnoma render qilinmadi (0 ta hujjat)');
    }

    await archive.finalize();
    await closed;

    // ZIP is on disk (reyestr included, else we'd have thrown above) → advance the talabnoma track
    // for this firm's debt>0 clients. The gate is reyestr inclusion, NOT per-letter PDF render
    // success: hippo sends from the reyestr we just guaranteed, so a client whose local PDF failed
    // to render is still genuinely "talabnoma sent". Parity with the single-case gen routes;
    // idempotent (fills nulls only, never overwrites a real earlier send date); non-fatal.
    // On «Bekor» we KEEP the partial ZIP (reyestr + rendered letters) for download, but do NOT advance
    // the talabnoma track — only some clients were processed, so marking everyone «sent» would be wrong.
    if (!canceled && paidPinfls.length) {
      await prisma.arizaCase.updateMany({
        where: { snapshotId: opts.snapshotId, firmId: opts.firmId, pinfl: { in: paidPinfls }, talabnomaAt: null },
        data: { talabnomaAt: new Date() },
      }).catch(() => {});
    }

    await prisma.job.updateMany({
      where: { id: jobId },
      // progress = PDFs actually rendered, total = clients expected (rows are pre-filtered to
      // debt>0), so made < expected == a genuine render failure the UI flags red as «yuklanmadi».
      data: canceled
        ? { status: 'CANCELED', progress: usedNames.size, total: rows.length, resultPath: `exports/${jobId}.zip`, message: `Bekor qilindi — ${usedNames.size} talabnoma`, cancelRequested: false }
        : { status: 'DONE', progress: usedNames.size, total: rows.length, resultPath: `exports/${jobId}.zip`, message: `${usedNames.size} talabnoma` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message } }).catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (output && !output.closed) output.destroy();
  }
}

export interface OfertaJobOpts {
  snapshotId?: number;
  firmId?: number;
  stages?: CaseStage[];
  insurancePct?: number; // таъминот % of principal (0 → policy text, no invented sum)
  caseIds?: number[];    // explicit case list (single-case gen-oferta) — overrides snapshot/firm/stages
  limit?: number;        // «belgilangan son» — render only the first N cases of the scope (0/omitted → all)
}

/** Background «Oferta» job: render ONLY the ofertas — one PDF per loan (contract) — for
 *  every case in scope, streamed into one ZIP grouped by client folder (a client with loans
 *  in several firms gets all their ofertas together). Same robust streaming/backpressure
 *  pattern as runPacketJob. Never throws — the outcome is recorded on the Job row. */
export async function runOfertaJob(jobId: number, opts: OfertaJobOpts): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });
  let browser: Browser | null = null;
  let output: fs.WriteStream | null = null;
  const zipPath = path.join(EXPORTS_DIR, `${jobId}.zip`);
  try {
    // Explicit case list (single-case gen-oferta) wins; otherwise the scope query.
    let caseIds: number[];
    if (opts.caseIds && opts.caseIds.length) {
      caseIds = opts.caseIds;
    } else {
      const rows = await prisma.arizaCase.findMany({
        where: {
          ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}),
          ...(opts.firmId ? { firmId: opts.firmId } : {}),
          ...(opts.stages && opts.stages.length ? { stage: { in: opts.stages } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      caseIds = rows.map((r) => r.id);
    }
    // «Belgilangan son» — build only the first N of the scope (ordered by id for a stable slice).
    // Skipped when an explicit caseIds list was given (single-case gen-oferta already picks its set).
    if (!opts.caseIds?.length && opts.limit && opts.limit > 0 && opts.limit < caseIds.length) caseIds = caseIds.slice(0, opts.limit);

    await fsp.mkdir(EXPORTS_DIR, { recursive: true });
    await pruneOldExports(); // eski/ortiqcha ZIP'larni tozalab, yangi yozishga joy ochamiz
    output = fs.createWriteStream(zipPath);
    const out = output;
    // store: true → payloads are already-compressed chromium PDFs; deflate would just burn
    // CPU that the parallel renders need. Same rationale as runPacketJob.
    const archive = archiver('zip', { store: true });
    let streamErr: Error | null = null;
    const closed = new Promise<void>((resolve, reject) => {
      out.on('close', resolve);
      out.on('error', (e) => { streamErr = e; reject(e); });
      archive.on('error', (e) => { streamErr = e; reject(e); });
    });
    // A stream error can reject `closed` on a teardown path that never awaits it (an early throw
    // jumps past `await closed`) → an unhandledRejection that crashes the process. A no-op handler
    // makes the rejection always-handled; the real `await closed` still surfaces it on the happy path.
    closed.catch(() => {});
    archive.pipe(out);

    // Oferta is HTML→PDF, so chromium is REQUIRED here (unlike the packet job where it's
    // optional) — a launch failure must fail the job, not silently produce an empty ZIP.
    try { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true }); }
    catch (e) { throw new Error(`chromium launch failed: ${e instanceof Error ? e.message : String(e)}`); }

    const pct = opts.insurancePct ?? 0;
    const usedPaths = new Set<string>();
    const producedCaseIds: number[] = []; // cases whose oferta(s) we actually rendered → stamp ofertaAt
    let done = 0;
    let canceled = false; // «Bekor» → break the loop, keep+finalize what's built so far
    let ofertaCount = 0;
    const CONCURRENCY = PDF_CONCURRENCY;
    for (let i = 0; i < caseIds.length; i += CONCURRENCY) {
      if (await cancelRequested(jobId)) { canceled = true; break; } // «Bekor» → stop; keep what's built
      if (streamErr) throw streamErr;
      const batch = caseIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (id) => ({ id, res: await buildCaseOfertas(id, browser as Browser, pct).catch(() => null) })),
      );
      for (const { id, res: r } of results) {
        if (streamErr) throw streamErr;
        if (r && r.files.length) {
          producedCaseIds.push(id); // ≥1 oferta made for this client → «Oferta: bor» on the card
          for (const f of r.files) {
            // Dedupe the FULL path (folder is shared across a client's firms → co-located),
            // so two same-named files never silently overwrite each other in the ZIP.
            let full = `${r.folder}/${f.name}`;
            if (usedPaths.has(full)) {
              const dot = f.name.lastIndexOf('.');
              const base = dot > 0 ? f.name.slice(0, dot) : f.name;
              const ext = dot > 0 ? f.name.slice(dot) : '';
              let k = 2;
              while (usedPaths.has(`${r.folder}/${base} (${k})${ext}`)) k++;
              full = `${r.folder}/${base} (${k})${ext}`;
            }
            usedPaths.add(full);
            archive.append(f.buf, { name: full });
            ofertaCount += 1;
          }
          if (out.writableNeedDrain) await once(out, 'drain');
        }
        done += 1;
      }
      await prisma.job.updateMany({ where: { id: jobId }, data: { progress: done, message: `${ofertaCount} oferta / ${done} case` } }).catch(() => {});
    }

    await archive.finalize();
    await closed;

    // Mark every client whose oferta(s) we actually produced (even on «Bekor» — they WERE generated),
    // so the doc card shows «Oferta: bor». Fill-null-only, never overwrites an earlier stamp; non-fatal.
    if (producedCaseIds.length) {
      await prisma.arizaCase.updateMany({ where: { id: { in: producedCaseIds }, ofertaAt: null }, data: { ofertaAt: new Date() } }).catch(() => {});
    }

    await prisma.job.updateMany({
      where: { id: jobId },
      // «Bekor» keeps the partial ZIP (downloadable) and reports CANCELED — never throws the work away.
      data: canceled
        ? { status: 'CANCELED', progress: done, total: done, resultPath: `exports/${jobId}.zip`, message: `Bekor qilindi — ${ofertaCount} oferta / ${done} case`, cancelRequested: false }
        : { status: 'DONE', progress: done, total: done, resultPath: `exports/${jobId}.zip`, message: `${ofertaCount} oferta / ${done} case` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message } }).catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (output && !output.closed) output.destroy();
  }
}
