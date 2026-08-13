// Server-side OCR for palata scans: render each PDF page with the Windows built-in
// OCR engine (scripts/palata/ocr-pdf.ps1 — zero installs), extract firma + PINFL +
// name/address per ariza, and merge into data/palata-scan.json (the dataset the
// palata panel reads). Runs as a background Job so the web upload returns instantly.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prisma } from './db';

const OCR_SCRIPT = path.join(process.cwd(), 'scripts', 'palata', 'ocr-pdf.ps1');
const DATA_PATH = path.join(process.cwd(), 'data', 'palata-scan.json');

export interface OcrPage { page: number; text: string }
// `source` = the retained scan file (in exports/palata-scans/) this ariza came from;
// with `pages` ("N-M", 1-indexed) it lets us extract just this client's signed pages.
export interface ScannedArizaFull { reg: string; pages: string; name: string; pinfl: string; firmKey: string; firm: string; address: string; phone: string; source?: string }

export const SCAN_STORE = path.join(process.cwd(), 'exports', 'palata-scans');

// ---------- extractor (ported from scripts/ariza-scan/ocr-extract.ts) ----------
const FIRM_KEYS: [RegExp, string][] = [
  [/BRIGHT/i, 'BRIGHT'], [/URBAN/i, 'URBAN'], [/COMMUNITY/i, 'COMMUNITY'],
  [/MUVAFFAQIYAT/i, 'MUVAFFAQIYAT'], [/FUNDFLOW/i, 'FUNDFLOW'],
];
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// The PINFL label "JShShIR:" gets mangled by OCR ("JShSh1R", "Jshshir", "JShSh|R"…).
// Require the "sh" so it matches ONLY the label — not stray "J…:" tokens in an address.
const PINFL_LABEL = /J[A-Za-z0-9|]{0,3}sh[A-Za-z0-9|]{0,5}[:\s.]+((?:\d[\s]?){13,17}\d)/i;
function pinflOf(text: string): string {
  const lab = text.match(PINFL_LABEL);
  if (lab) { const d = lab[1].replace(/\D/g, '').match(/\d{14}/); if (d) return d[0]; }
  // Fallback: a standalone 14-digit run — on a header page the only one is the PINFL
  // (account = 20 digits, phone = 12, STIR = 9), so it's safe.
  const bare = text.match(/(?<!\d)\d{14}(?!\d)/);
  return bare ? bare[0] : '';
}
// A header page carries a PINFL AND the letterhead ("Arizachi") or a clean JShShIR
// label — debt pages have neither, so this is the ariza boundary.
const hasPinfl = (text: string) => pinflOf(text) !== '' && (/Arizachi/i.test(text) || PINFL_LABEL.test(text));

function firmOf(text: string): { firm: string; firmKey: string } {
  const hit = FIRM_KEYS.find(([re]) => re.test(text));
  const q = text.match(/"([^"]*(?:FINANCING|SOLUTIONS|MICROFINANCE|MIKROMOLIYA)[^"]*)"/i);
  return { firm: q ? clean(q[1]) : '', firmKey: hit ? hit[1] : '' };
}

// Name + address sit after the firm's (last) STIR and before the PINFL. We cut on the
// KNOWN pinfl digits (space-tolerant) — robust even when the JShShIR label is garbled.
function nameAddrOf(text: string, pinfl: string): { name: string; address: string } {
  // OCR often puts a space before the apostrophe ("Farg 'ona", "ko 'chasi") which splits
  // one word in two — rejoin so region names like Farg'ona aren't torn between name/addr.
  const t = clean(text).replace(/(\S)\s+'/g, "$1'");
  // Anchor after the firm's LAST "STIR: <9 digits>". OCR sometimes mangles a digit
  // ("311" → "3n"), so allow 1-3 stray alnum chars at the STIR value's start.
  const afterStir = t.match(/.*\bSTIR\b[:\s]*[\dA-Za-z]{1,3}[\d ]{4,}\s*(.+)$/i);
  let seg = afterStir ? clean(afterStir[1]) : '';
  // Safety net: if the firm block still leaked in (a 15+ digit account / another STIR /
  // MFO remains), drop everything up to the last such firm marker before the name.
  seg = seg.replace(/^.*(?:\d{15,}|\bMFO\b|\bSTIR\b)[\dA-Za-z.,:•\s]*?\s(?=[A-ZЎҚҒА-Я])/u, '');
  if (pinfl) {
    const spaced = pinfl.split('').join('\\s?');       // "4 2 0 0 5 …" tolerant of OCR spacing
    seg = seg.replace(new RegExp(spaced + '.*$'), ''); // drop the PINFL and everything after
    seg = seg.replace(/\s+J\S{1,8}[:\s.]*$/i, '');     // drop the trailing "JShShIR:" label word
  }
  const block = clean(seg);
  const am = block.match(/\s(\S*\s*(?:tumani|tuman|tillilani|shahri|shahar|viloyati|viloyat|MFY|QFY)\b.*)$/i);
  let name = am ? clean(block.slice(0, am.index)) : block;
  const address = am ? clean(am[1]) : '';
  name = name.replace(/^[^A-Za-zА-Яа-яЎўҒғҚқҲҳ']+/u, '').trim();
  if (/FINANCING|MIKROMOLIYA|MCHJ|\bMMT\b/i.test(name)) name = '';
  return { name, address };
}
function phoneOf(text: string): string {
  const m = text.match(/Tel[:\s]*(\+?\d[\d ]{6,})/i);
  return m ? m[1].replace(/\s/g, '') : '';
}

/** Group OCR pages into arizas by the header boundary (a page carrying a Jshshir PINFL). */
export function extractArizas(pages: OcrPage[]): ScannedArizaFull[] {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const groups: { start: number; texts: string[] }[] = [];
  let cur: { start: number; texts: string[] } | null = null;
  for (const p of sorted) {
    if (hasPinfl(p.text)) { if (cur) groups.push(cur); cur = { start: p.page, texts: [p.text] }; }
    else if (cur) cur.texts.push(p.text);
  }
  if (cur) groups.push(cur);
  return groups.map((g) => {
    const header = g.texts[0];
    const pinfl = pinflOf(header);
    const { firm, firmKey } = firmOf(header);
    const { name, address } = nameAddrOf(header, pinfl);
    const end = g.start + g.texts.length - 1;
    return { reg: String(g.start + 1), pages: `${g.start + 1}-${end + 1}`, name, pinfl, firmKey, firm, address, phone: phoneOf(header) };
  }).filter((a) => a.pinfl);
}

// ---------- OCR spawn ----------
/** Render + OCR a PDF via the Windows engine → writes [{page,text}] JSON to outJson.
 *  onProgress(done,total) fires as the script prints "page X/Y". */
export function ocrPdf(pdfPath: string, outJson: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OCR_SCRIPT, '-Pdf', pdfPath, '-Out', outJson], { windowsHide: true });
    let err = '';
    ps.stdout.on('data', (d) => { const m = /page\s+(\d+)\/(\d+)/i.exec(String(d)); if (m && onProgress) onProgress(Number(m[1]), Number(m[2])); });
    ps.stderr.on('data', (d) => { err += String(d); });
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error('OCR xatosi: ' + (err.trim().split('\n').pop() || `exit ${code}`)))));
  });
}

// ---------- merge ----------
export async function mergeArizas(fresh: ScannedArizaFull[], update = false): Promise<{ added: number; updated: number; total: number }> {
  let cur: ScannedArizaFull[] = [];
  try { cur = JSON.parse(await fsp.readFile(DATA_PATH, 'utf8')); } catch { cur = []; }
  const idx = new Map<string, number>();
  cur.forEach((x, i) => { if (x.pinfl) idx.set(x.pinfl, i); });
  let added = 0, updated = 0;
  for (const a of fresh) {
    if (!a.pinfl) continue;
    const at = idx.get(a.pinfl);
    if (at === undefined) { cur.push(a); idx.set(a.pinfl, cur.length - 1); added++; }
    else if (update) { cur[at] = a; updated++; } // «yangilash» — re-scan overwrites source/pages/name
  }
  cur.sort((a, b) => Number(a.reg) - Number(b.reg));
  await fsp.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fsp.writeFile(DATA_PATH, JSON.stringify(cur, null, 1));
  return { added, updated, total: cur.length };
}

// A live OCR job refreshes updatedAt every ~10 pages (~20s). If a RUNNING/PENDING job
// hasn't updated in STALE_MS, its process died (dev-server restart) — reap it so it
// never permanently blocks new uploads or leaves the panel polling forever.
const STALE_MS = 3 * 60 * 1000;
export async function reapStaleOcrJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  await prisma.job.updateMany({
    where: { type: { in: ['PALATA_OCR', 'PALATA_ATTACH'] }, status: { in: ['PENDING', 'RUNNING'] }, updatedAt: { lt: cutoff } },
    data: { status: 'FAILED', message: 'Uzilib qoldi (server qayta ishga tushdi) — qayta yuklang' },
  }).catch(() => {});
}

// ---------- background job ----------
/** OCR each uploaded PDF, extract arizas, merge the dataset. Never throws — records
 *  the outcome on the Job row (the fire-and-forget caller needs no catch). Each scan
 *  is RETAINED in SCAN_STORE so a client's signed pages stay downloadable. */
export async function runPalataOcrJob(jobId: number, filePaths: string[], update = false): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });
  await fsp.mkdir(SCAN_STORE, { recursive: true }).catch(() => {});
  try {
    let added = 0, total = 0;
    const freshPinfls = new Set<string>(); // PINFLs read from THIS upload (for «yangilash»)
    for (let i = 0; i < filePaths.length; i++) {
      const out = path.join(os.tmpdir(), `palata-ocr-${jobId}-${i}.json`);
      let last = 0;
      await ocrPdf(filePaths[i], out, (done, tot) => {
        // Throttle DB writes: every 10 pages (progress = pages OCR'd on the current file).
        if (done - last >= 10 || done === tot) { last = done; prisma.job.updateMany({ where: { id: jobId }, data: { progress: done, total: tot } }).catch(() => {}); }
      });
      const pages: OcrPage[] = JSON.parse(await fsp.readFile(out, 'utf8'));
      // Retain the scan (move temp → durable store) and tag each ariza with its source
      // file so the panel can extract & download that client's signed pages later.
      const sourceId = path.basename(filePaths[i]);
      await fsp.rename(filePaths[i], path.join(SCAN_STORE, sourceId)).catch(async () => {
        await fsp.copyFile(filePaths[i], path.join(SCAN_STORE, sourceId)).catch(() => {});
        await fsp.rm(filePaths[i], { force: true }).catch(() => {});
      });
      const got = extractArizas(pages).map((a) => ({ ...a, source: sourceId }));
      got.forEach((g) => { if (g.pinfl) freshPinfls.add(g.pinfl); });
      // Merge THIS file's arizas to disk immediately — a later file dying can't lose it.
      // `update` overwrites an already-known client's source/pages with the fresh scan.
      const r = await mergeArizas(got, update);
      added += r.added; total = r.total;
      await fsp.rm(out, { force: true }).catch(() => {});
    }

    // ── Phase 2: BAZAGA SAQLASH — split each client's signed pages into its own PDF
    // and attach it to the matching case (CaseDocument SIGNED_ARIZA) so the signed
    // ariza is stored per-case and flows into the court packet. Runs over the WHOLE
    // merged dataset (idempotent) so previously-unlinked clients whose cases now
    // exist are picked up too. A dynamic import keeps the module graph acyclic
    // (palata-attach imports SCAN_STORE from here). Non-fatal: an attach hiccup must
    // not fail an OCR run whose scans already landed.
    let saved = 0, updatedCount = 0, noCase = 0;
    try {
      await prisma.job.updateMany({ where: { id: jobId }, data: { message: 'Bazaga saqlanmoqda…', progress: 0, total: 1 } });
      const { attachAllScanned } = await import('./palata-attach');
      let lastAt = 0;
      const att = await attachAllScanned({
        // «yangilash» — only THIS upload's clients overwrite an already-saved doc.
        replacePinfls: update ? freshPinfls : undefined,
        onProgress: (d, t) => {
          // Throttle DB writes (every 10 arizas), same rhythm as the OCR progress.
          if (d - lastAt >= 10 || d === t) { lastAt = d; prisma.job.updateMany({ where: { id: jobId }, data: { progress: d, total: Math.max(1, t) } }).catch(() => {}); }
        },
      });
      saved = att.linked; updatedCount = att.updated; noCase = att.noCase;
    } catch (e) { console.error('[palata-ocr] attach phase failed', e); }

    const msg = `+${added} yangi ariza (jami ${total}) · ${saved} bazaga saqlandi`
      + (updatedCount ? ` · ${updatedCount} yangilandi` : '')
      + (noCase ? ` · ${noCase} ish topilmadi` : '');
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'DONE', message: msg, progress: 1, total: 1 } });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message: m } }).catch(() => {});
  }
}
