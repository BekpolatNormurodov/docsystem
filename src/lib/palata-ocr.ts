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
async function pdfPageCount(pdfPath: string): Promise<number> {
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
    // BO'LAK-BO'LAK render+OCR. Butun katta PDF'ni bir chaqiruvda render qilsak, birinchi
    // sahifagacha progress 0% turadi (800 sahifada bir necha daqiqa) va stale-reaper (3min)
    // ishni jonli bo'lsa ham o'ldiradi. Buning o'rniga har CHUNK sahifani pdftoppm -f/-l
    // bilan render qilib, parallel OCR qilamiz, progress'ni yangilaymiz (updatedAt tirik) va
    // o'sha PNG'larni o'chiramiz (disk yengil). Real % 1-sahifadan ko'rinadi.
    const CHUNK = Math.max(workers * 2, 16);
    let done = 0;
    for (let from = 1; from <= total; from += CHUNK) {
      // Bekor qilingan bo'lsa — har bo'lak boshida to'xtaymiz (joriy bo'lak ~16 sahifada tugaydi).
      if (shouldStop && await shouldStop()) throw new Error(CANCELLED);
      const to = Math.min(from + CHUNK - 1, total);
      const prefix = path.join(dir, `c${from}`);
      // 1) shu oraliqni PDF → PNG (150 dpi). Fayl nomi haqiqiy sahifa raqamini saqlaydi.
      try {
        await execFileP('pdftoppm', ['-png', '-r', '150', '-f', String(from), '-l', String(to), pdfPath, prefix], { maxBuffer: 1 << 27 });
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err?.code === 'ENOENT') throw new Error('«pdftoppm» topilmadi — serverga poppler-utils o‘rnating');
        throw new Error('PDF rasmga o‘girilmadi: ' + (err?.message ?? String(e)));
      }
      const base = path.basename(prefix);
      const files = (await fsp.readdir(dir)).filter((f) => f.startsWith(base) && /\.png$/i.test(f))
        .sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0));
      // 2) parallel OCR — tesseract har sahifada bitta yadroni band qiladi.
      let next = 0;
      const runOne = async () => {
        for (;;) {
          const k = next++;
          if (k >= files.length) return;
          const pageNo = parseInt(files[k].replace(/\D/g, ''), 10) || (from + k); // haqiqiy sahifa raqami
          let text = '';
          try {
            // OMP_THREAD_LIMIT=1 — har tesseract BIR ipli bo'lsin. Aks holda tesseract
            // o'zi OpenMP bilan barcha yadroni oladi; biz 8 ta parallel ishlatsak 8×8 ip
            // bir-birini bo'g'adi (CPU 800% ko'rinadi-yu unum tushadi). Bitta ipdan biz
            // o'zimiz 8 parallel = toza masshtab. --psm 6: og'ir sahifa-layout tahlilisiz
            // (bizga faqat matn kerak, tartib emas) — sekин skanlarda ancha tez.
            const { stdout } = await execFileP('tesseract', [path.join(dir, files[k]), 'stdout', '-l', langs, '--psm', '6', '-c', 'tessedit_do_invert=0'], { maxBuffer: 1 << 27, env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
            text = stdout;
          } catch (e) {
            const err = e as NodeJS.ErrnoException;
            if (err?.code === 'ENOENT') throw new Error('«tesseract» topilmadi — serverga tesseract-ocr o‘rnating');
            // Bitta sahifa o'qilmasa — bo'sh matn bilan davom (butun paket to'xtamaydi).
          }
          pages[pageNo - 1] = { page: pageNo - 1, text };
          onProgress?.(++done, total);
        }
      };
      await Promise.all(Array.from({ length: workers }, runOne));
      // 3) shu bo'lakning PNG'larini o'chir — disk to'lиб ketmasin.
      await Promise.all(files.map((f) => fsp.rm(path.join(dir, f), { force: true }).catch(() => {})));
    }
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

// ---------- background job ----------
/** OCR each uploaded PDF, extract arizas, merge the dataset. Never throws — records
 *  the outcome on the Job row (the fire-and-forget caller needs no catch). Each scan
 *  is RETAINED in SCAN_STORE so a client's signed pages stay downloadable. */
export async function runPalataOcrJob(jobId: number, filePaths: string[], update = false): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });
  await fsp.mkdir(SCAN_STORE, { recursive: true }).catch(() => {});
  // Heartbeat: katta PDF'ning pdftoppm render bosqichi bitta uzun chaqiruv — u paytda
  // hech qanday progress yozilmaydi. updatedAt'ni har 30s da yangilab turmasak, stale
  // tekshiruvchisi (STALE_MS=3min) ishni o'lgan deb belgilab «Uzilib qoldi» qiladi —
  // holbuki u hali ishlab turibdi. Interval ish tugagach to'xtatiladi.
  const beat = setInterval(() => {
    prisma.job.updateMany({ where: { id: jobId, status: { in: ['PENDING', 'RUNNING'] } }, data: { message: 'OCR ishlayapti…' } }).catch(() => {});
  }, 30_000);
  try {
    let added = 0, total = 0;
    for (let i = 0; i < filePaths.length; i++) {
      const out = path.join(os.tmpdir(), `palata-ocr-${jobId}-${i}.json`);
      let last = 0;
      await ocrPdf(filePaths[i], out, (done, tot) => {
        // Throttle DB writes: every 10 pages (progress = pages OCR'd on the current file).
        if (done - last >= 10 || done === tot) { last = done; prisma.job.updateMany({ where: { id: jobId }, data: { progress: done, total: tot } }).catch(() => {}); }
      }, async () => {
        // Bekor tekshiruvi — «Bekor qilish» tugmasi job status'ni RUNNING'dan chiqaradi.
        const j = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } }).catch(() => null);
        return !!j && j.status !== 'RUNNING' && j.status !== 'PENDING';
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
      // Merge THIS file's arizas to disk immediately — a later file dying can't lose it.
      // `update` overwrites an already-known client's source/pages with the fresh scan.
      const r = await mergeArizas(got, update);
      added += r.added; total = r.total;
      await fsp.rm(out, { force: true }).catch(() => {});
    }

    // OCR faqat OʻQIYDI — bazaga saqlash endi ALOHIDA, TASDIQ bilan ketadi («Bazaga
    // saqlash» tugmasi). Shunda foydalanuvchi avval xulosani koʻradi (nechta oʻqildi,
    // qaysi firmadan qanchasi, qanchasiga «mos ish topilmadi») va soʻng saqlaydi. Saqlash
    // /konveyer/palata-attach orqali attachAllScanned bilan bajariladi.
    const msg = `+${added} yangi ariza oʻqildi (jami ${total}) — «Bazaga saqlash»ni tasdiqlang`;
    await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'DONE', message: msg, progress: 1, total: 1 } });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    // Bekor qilingan bo'lsa — cancel route allaqachon status/message qo'ygan; ustiga
    // yozmaymiz (faqat message bo'sh qolgan bo'lsa chiroyli belgilaymiz).
    if (m === CANCELLED) {
      await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message: 'Bekor qilindi' } }).catch(() => {});
    } else {
      await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message: m } }).catch(() => {});
    }
  } finally {
    clearInterval(beat);
  }
}
