// Server-side OCR for palata scans: render each PDF page with poppler (pdftoppm) and OCR it with
// tesseract — cross-platform (Linux/Docker/Mac), no Windows/PowerShell. Extracts firma + PINFL +
// name/address per ariza and merges into data/palata-scan.json (the dataset the palata panel reads).
// Runs as a background Job so the web upload returns instantly. Docker (web) installs poppler-utils +
// tesseract-ocr (+ uzb/eng traineddata).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prisma } from './db';

const execFileP = promisify(execFile);
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
  const sorted = pages.filter((p): p is OcrPage => !!p).sort((a, b) => a.page - b.page);
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

// ---------- OCR (cross-platform: poppler + tesseract) ----------
// Arizalar lotin o'zbekcha — «uzb» modeli lotin harflar (firma nomlari ham lotin) va
// PINFL raqamlarini o'qiydi. «eng» qo'shilsa tesseract IKKI til modelini birga ishlatib
// har sahifani ~2x sekinlashtiradi, foydasi deyarli yo'q — shuning uchun faqat «uzb»
// (yo'q bo'lsa «eng» ga tushamiz). Bir marta aniqlaymiz.
let OCR_LANGS: string | null = null;
async function ocrLangs(): Promise<string> {
  if (OCR_LANGS) return OCR_LANGS;
  try {
    const { stdout } = await execFileP('tesseract', ['--list-langs']);
    const have = new Set(stdout.split(/\r?\n/).map((s) => s.trim()));
    OCR_LANGS = have.has('uzb') ? 'uzb' : 'eng';
  } catch { OCR_LANGS = 'eng'; }
  return OCR_LANGS;
}

/** PDF sahifalar soni (poppler `pdfinfo`). Topilmasa 0. Chunk render uchun oldindan kerak. */
export async function pdfPageCount(pdfPath: string): Promise<number> {
  try {
    const { stdout } = await execFileP('pdfinfo', [pdfPath], { maxBuffer: 1 << 20 });
    const m = stdout.match(/^Pages:\s*(\d+)/m);
    return m ? parseInt(m[1], 10) : 0;
  } catch { return 0; }
}

/** Render (pdftoppm) + OCR (tesseract) a PDF → writes [{page,text}] JSON (page 0-indexed, ps1 bilan
 *  bir xil). onProgress(done,total) har OCR qilingan sahifada. Cross-platform (Linux/Mac/Docker). */
export const CANCELLED = '__CANCELLED__';
export async function ocrPdf(pdfPath: string, outJson: string, onProgress?: (done: number, total: number) => void, shouldStop?: () => Promise<boolean>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'palata-ppm-'));
  try {
    const total = await pdfPageCount(pdfPath);
    if (total === 0) throw new Error('PDF sahifalari topilmadi');
    const langs = await ocrLangs();
    const workers = Math.max(1, Math.min(total, os.cpus().length || 4));
    const pages: OcrPage[] = new Array(total);
    // SAHIFA-DARAJASIDA render+OCR pool. Ilgari butun bo'lakni bitta pdftoppm bilan render
    // qilardik — u BIR ipli, shuning uchun 24 yadroda render bosqichi 23 yadroni bekor
    // qoldirib, asosiy to'siqqa aylandi (CPU ~100% da qotib qolardi). Endi har worker O'Z
    // sahifasini o'zi render qilib (pdftoppm -singlefile) darrov OCR qiladi — shunda barcha
    // yadro ham render, ham OCR bilan doim to'la band. workers = yadro soni.
    let next = 1, done = 0, stop = false;
    const runOne = async () => {
      for (;;) {
        if (stop) return;
        const p = next++;
        if (p > total) return;
        // Bekor tekshiruvi (~har 20 sahifada bittasi yetarli — DB'ni bosmaslik uchun).
        if (shouldStop && p % 20 === 0 && await shouldStop()) { stop = true; return; }
        const png = path.join(dir, `p${p}`); // -singlefile → p{p}.png
        let text = '';
        try {
          await execFileP('pdftoppm', ['-png', '-r', '150', '-f', String(p), '-l', String(p), '-singlefile', pdfPath, png], { maxBuffer: 1 << 27 });
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (err?.code === 'ENOENT') throw new Error('«pdftoppm» topilmadi — serverga poppler-utils o‘rnating');
          pages[p - 1] = { page: p - 1, text: '' }; onProgress?.(++done, total); continue; // bu sahifa render bo'lmadi
        }
        try {
          // OMP_THREAD_LIMIT=1 — har tesseract BIR ipli. Aks holda tesseract o'zi OpenMP
          // bilan barcha yadroni oladi; biz N parallel ishlatsak N×N ip bir-birini bo'g'adi
          // (CPU 2000% ko'rinadi-yu unum tushadi). Bitta ipdan biz N parallel = toza masshtab.
          // --psm 6: og'ir sahifa-layout tahlilisiz (bizga faqat matn kerak, tartib emas).
          const { stdout } = await execFileP('tesseract', [`${png}.png`, 'stdout', '-l', langs, '--psm', '6', '-c', 'tessedit_do_invert=0'], { maxBuffer: 1 << 27, env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
          text = stdout;
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (err?.code === 'ENOENT') throw new Error('«tesseract» topilmadi — serverga tesseract-ocr o‘rnating');
          // Bitta sahifa o'qilmasa — bo'sh matn bilan davom (butun paket to'xtamaydi).
        }
        await fsp.rm(`${png}.png`, { force: true }).catch(() => {}); // diskni yengil ushlaymiz
        pages[p - 1] = { page: p - 1, text };
        onProgress?.(++done, total);
      }
    };
    await Promise.all(Array.from({ length: workers }, runOne));
    if (stop) throw new Error(CANCELLED);
    // Render bo'lmagan sahifa (pdftoppm bitta sahifani bermasa) massivда null qoldiradi —
    // sahifa raqamini saqlagan holda bo'sh matn bilan to'ldiramiz (extractArizas yiqilmasin).
    for (let i = 0; i < total; i++) if (!pages[i]) pages[i] = { page: i, text: '' };
    await fsp.writeFile(outJson, JSON.stringify(pages));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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

// ---------- background job (NAVBAT / queue) ----------
// Yuklangan PDF'lar shu papkaga tushadi; drainer ularni birma-bir (nom bo'yicha
// tartibda) yutadi. Ish ketayotganda yangi yuklama shu yerga qo'shiladi va o'sha
// drainer uni ham oladi — foydalanuvchi 2-3 PDF ketma-ket tashlab, kutmaydi.
export const QUEUE_DIR = path.join(process.cwd(), 'exports', 'palata-ocr-queue');
const REPLACE_MARK = path.join(QUEUE_DIR, '.replace'); // mavjud bo'lsa — «Mavjudlarni yangilash» yoqilgan
async function nextQueueFile(): Promise<{ path: string; remaining: number } | null> {
  try {
    const files = (await fsp.readdir(QUEUE_DIR)).filter((f) => /\.pdf$/i.test(f)).sort();
    return files.length ? { path: path.join(QUEUE_DIR, files[0]), remaining: files.length } : null;
  } catch { return null; }
}
async function queueFileCount(): Promise<number> {
  try { return (await fsp.readdir(QUEUE_DIR)).filter((f) => /\.pdf$/i.test(f)).length; } catch { return 0; }
}
/** POST navbatga fayl qo'shganda «replace» bayrog'ini yozadi/o'chiradi (resume o'qishi uchun). */
export async function setQueueReplace(on: boolean): Promise<void> {
  await fsp.mkdir(QUEUE_DIR, { recursive: true }).catch(() => {});
  if (on) await fsp.writeFile(REPLACE_MARK, '1').catch(() => {});
  else await fsp.rm(REPLACE_MARK, { force: true }).catch(() => {});
}
async function queueWantsReplace(): Promise<boolean> {
  return fsp.access(REPLACE_MARK).then(() => true).catch(() => false);
}

/** Navbatda fayl bor-u, lekin jonli OCR ishi yo'q bo'lsa (masalan deploy/restart drainer'ni
 *  o'ldirgan) — yangi drainer boshlab navbatni davom ettiradi. GET pollda chaqiriladi, shuning
 *  uchun restartdan keyin navbat o'zini tiklaydi. Bir vaqtda faqat bitta ish bo'ladi. */
export async function resumeOcrQueueIfIdle(): Promise<void> {
  if ((await queueFileCount()) === 0) return;
  const live = await prisma.job.findFirst({ where: { type: 'PALATA_OCR', status: { in: ['PENDING', 'RUNNING'] } } });
  if (live) return;
  const job = await prisma.job.create({ data: { type: 'PALATA_OCR', status: 'PENDING', total: 0, progress: 0 } });
  void drainOcrQueue(job.id, await queueWantsReplace());
}

/** Drain the OCR queue: OCR each queued PDF in turn, extract arizas, merge the dataset,
 *  picking up files added mid-run. Never throws — records the outcome on the Job row.
 *  Each scan is RETAINED in SCAN_STORE so a client's signed pages stay downloadable. */
export async function drainOcrQueue(jobId: number, update = false): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });
  await fsp.mkdir(SCAN_STORE, { recursive: true }).catch(() => {});
  const isCancelled = async () => {
    const j = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } }).catch(() => null);
    return !!j && j.status !== 'RUNNING' && j.status !== 'PENDING';
  };
  // Heartbeat: katta PDF'ning pdftoppm render bosqichi bitta uzun chaqiruv — u paytda
  // progress yozilmaydi. updatedAt'ni har 30s da yangilab turmasak, stale tekshiruvchisi
  // (STALE_MS=3min) ishni jonli bo'lsa ham o'lgan deb belgilaydi.
  const beat = setInterval(() => {
    prisma.job.updateMany({ where: { id: jobId, status: { in: ['PENDING', 'RUNNING'] } }, data: { message: 'OCR ishlayapti…' } }).catch(() => {});
  }, 30_000);
  try {
    let added = 0, total = 0, fileIdx = 0;
    for (;;) {
      if (await isCancelled()) throw new Error(CANCELLED);
      const nx = await nextQueueFile();
      if (!nx) break; // navbat bo'sh — tugadi
      const queuedTail = nx.remaining - 1; // shu fayldan keyin yana nechta navbatda
      const out = path.join(os.tmpdir(), `palata-ocr-${jobId}-${fileIdx++}.json`);
      let last = 0;
      await ocrPdf(nx.path, out, (done, tot) => {
        // Throttle DB writes: every 10 pages. Message: nechta fayl navbatda qolganini ko'rsatadi.
        if (done - last >= 10 || done === tot) {
          last = done;
          const msg = queuedTail > 0 ? `OCR ishlayapti… (yana ${queuedTail} ta navbatda)` : 'OCR ishlayapti…';
          prisma.job.updateMany({ where: { id: jobId }, data: { progress: done, total: tot, message: msg } }).catch(() => {});
        }
      }, isCancelled);
      const pages: OcrPage[] = JSON.parse(await fsp.readFile(out, 'utf8'));
      // Retain the scan (move queue → durable store) and tag each ariza with its source.
      const sourceId = path.basename(nx.path);
      await fsp.rename(nx.path, path.join(SCAN_STORE, sourceId)).catch(async () => {
        await fsp.copyFile(nx.path, path.join(SCAN_STORE, sourceId)).catch(() => {});
        await fsp.rm(nx.path, { force: true }).catch(() => {});
      });
      const got = extractArizas(pages).map((a) => ({ ...a, source: sourceId }));
      // Merge THIS file's arizas immediately — a later file dying can't lose it.
      const r = await mergeArizas(got, update);
      added += r.added; total = r.total;
      await fsp.rm(out, { force: true }).catch(() => {});
    }

    // Navbat bo'shadi — «replace» bayrog'ini olib tashlaymiz (keyingi yuklama o'zinikini yozadi).
    await fsp.rm(REPLACE_MARK, { force: true }).catch(() => {});
    // OCR faqat OʻQIYDI — bazaga saqlash ALOHIDA, TASDIQ bilan («Bazaga saqlash» tugmasi).
    const msg = `+${added} yangi ariza oʻqildi (jami ${total}) — «Bazaga saqlash»ni tasdiqlang`;
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'DONE', message: msg, progress: 1, total: 1 } });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    // Bekor qilingan bo'lsa — cancel route allaqachon status/message qo'ygan; ustiga
    // yozmaymiz (faqat message bo'sh qolgan bo'lsa chiroyli belgilaymiz).
    if (m === CANCELLED) {
      // Bekor — navbatda qolgan yuklamalarni ham o'chiramiz (.replace bayrog'i bilan birga).
      await fsp.readdir(QUEUE_DIR).then((fs2) => Promise.all(fs2.map((f) => fsp.rm(path.join(QUEUE_DIR, f), { force: true }).catch(() => {})))).catch(() => {});
      await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message: 'Bekor qilindi' } }).catch(() => {});
    } else {
      await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message: m } }).catch(() => {});
    }
  } finally {
    clearInterval(beat);
  }
}
