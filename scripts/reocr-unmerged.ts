/**
 * reocr-unmerged.ts — SCAN_STORE'dagi (exports/palata-scans) OCR'i TUGAMAY/merge bo'lmay
 * qolgan skan fayllarni QAYTA yuklamasdan OCR qilib, palata-scan.json'ga qo'shadi, so'ng
 * har arizani case'iga SIGNED_ARIZA qilib biriktiradi. «uzilib qolgan» katta fayllar
 * (community.pdf kabi) shu bilan qutqariladi — 71M ni qayta upload qilishga hojat yo'q.
 *
 * «un-merged» = SCAN_STORE'da bor, lekin palata-scan.json'da hech ariza bermagan fayl
 * (source ro'yxatida yo'q). mergeArizas pinfl bo'yicha dedupe qiladi — allaqachon o'qilgan
 * arizalar takror qo'shilmaydi (xavfsiz).
 *
 *   node --import tsx scripts/reocr-unmerged.ts                     # DRY-RUN: un-merged fayllar + sahifa soni
 *   node --import tsx scripts/reocr-unmerged.ts --go               # hammasini OCR+merge, so'ng biriktir
 *   node --import tsx scripts/reocr-unmerged.ts --go --match=community   # faqat nomida «community» borlar
 *   node --import tsx scripts/reocr-unmerged.ts --go --no-attach   # OCR+merge (biriktirmasdan)
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prisma } from '../src/lib/db';
import { SCAN_STORE, ocrPdf, extractArizas, mergeArizas, pdfPageCount } from '../src/lib/palata-ocr';
import { readScannedArizas } from '../src/lib/palata-scan';
import { attachAllScanned } from '../src/lib/palata-attach';

const GO = process.argv.includes('--go');
const NO_ATTACH = process.argv.includes('--no-attach');
const matchArg = process.argv.find((a) => a.startsWith('--match='));
const MATCH = matchArg ? matchArg.slice('--match='.length).toLowerCase() : null;

async function main() {
  // 1) Allaqachon ariza bergan manbalar (source basename) — bularni tegmaymiz.
  const mergedSources = new Set(readScannedArizas().map((a) => a.source).filter(Boolean) as string[]);

  // 2) SCAN_STORE'dagi barcha PDF'lar.
  let files: string[] = [];
  try { files = (await fsp.readdir(SCAN_STORE)).filter((f) => /\.pdf$/i.test(f)); }
  catch { console.log('SCAN_STORE topilmadi:', SCAN_STORE); return; }

  // 3) un-merged (+ ixtiyoriy nom filtri).
  let todo = files.filter((f) => !mergedSources.has(f));
  if (MATCH) todo = todo.filter((f) => f.toLowerCase().includes(MATCH));
  todo.sort();

  console.log(`SCAN_STORE: ${files.length} PDF · merged: ${mergedSources.size} · UN-MERGED${MATCH ? ` (match="${MATCH}")` : ''}: ${todo.length}`);
  if (todo.length === 0) { console.log('Qayta OCR qilinadigan fayl yo’q.'); return; }

  // Har un-merged faylning sahifa soni (dry-run'da ham foydali).
  for (const f of todo) {
    const pages = await pdfPageCount(path.join(SCAN_STORE, f)).catch(() => 0);
    console.log(`  ${String(pages).padStart(5)} sahifa  ${f}`);
  }
  if (!GO) { console.log('\nDRY-RUN. Bajarish uchun: --go (ixtiyoriy --match=community / --no-attach).'); return; }

  // 4) Har faylni OCR → extract → merge (source = basename). Idempotent (pinfl dedupe).
  let totalAdded = 0;
  for (let i = 0; i < todo.length; i++) {
    const f = todo[i];
    const src = path.join(SCAN_STORE, f);
    const out = path.join(os.tmpdir(), `reocr-${Date.now()}-${i}.json`);
    process.stdout.write(`[${i + 1}/${todo.length}] OCR: ${f} … `);
    try {
      let lastLog = 0;
      await ocrPdf(src, out, (done, tot) => {
        if (done - lastLog >= 50 || done === tot) { lastLog = done; process.stdout.write(`${done}/${tot} `); }
      });
      const pages = JSON.parse(await fsp.readFile(out, 'utf8'));
      const got = extractArizas(pages).map((a) => ({ ...a, source: f }));
      const r = await mergeArizas(got, false);
      totalAdded += r.added;
      console.log(`→ +${r.added} ariza (jami ${r.total})`);
    } catch (e) {
      console.log(`XATO: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await fsp.rm(out, { force: true }).catch(() => {});
    }
  }
  console.log(`\nJami yangi ariza: +${totalAdded}`);

  // 5) Biriktirish — arizalarni case'lariga SIGNED_ARIZA qilib bog'laydi.
  if (NO_ATTACH) { console.log('--no-attach: biriktirilmadi. Keyin «Bazaga saqlash» bosing.'); return; }
  console.log('Biriktirilyapti (attachAllScanned)…');
  const a = await attachAllScanned({ onProgress: (d, t) => { if (d % 200 === 0 || d === t) process.stdout.write(`${d}/${t} `); } });
  console.log(`\nBiriktirish: +${a.linked} yangi · ${a.already} avval bor · ${a.noCase} ish topilmadi · ${a.noMatch} mos kelmadi · ${a.advanced} bosqich oldinga`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
