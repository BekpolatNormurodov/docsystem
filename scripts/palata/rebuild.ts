// Rebuild data/palata-scan.json cleanly with the current extractor, tagging each ariza
// with its retained source scan. Bulk (136) comes from the Scan_0003 OCR page-dump;
// the 2 reference arizas are re-OCR'd from their stored PDFs. Dedup by PINFL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractArizas, ocrPdf, SCAN_STORE, type ScannedArizaFull } from '../../src/lib/palata-ocr';

(async () => {
  const ocrAll = process.argv[2];
  const out: ScannedArizaFull[] = [];

  // Bulk: Scan_0003 (already OCR'd to a page dump).
  for (const a of extractArizas(JSON.parse(fs.readFileSync(ocrAll, 'utf8')))) out.push({ ...a, source: 'scan_0003.pdf' });
  console.log('scan_0003:', out.length);

  // Reference arizas: OCR the retained store copies.
  for (const src of ['ariza_42.pdf', 'ariza_57.pdf']) {
    const file = path.join(SCAN_STORE, src);
    if (!fs.existsSync(file)) { console.log('MISSING', src); continue; }
    const tmp = path.join(os.tmpdir(), `rebuild-${src}.json`);
    await ocrPdf(file, tmp);
    const got = extractArizas(JSON.parse(fs.readFileSync(tmp, 'utf8'))).map((a) => ({ ...a, source: src }));
    out.push(...got);
    console.log(src + ':', got.map((g) => `${g.pinfl} ${g.name}`).join(' | '));
  }

  // Dedup by PINFL, sort by reg.
  const seen = new Set<string>();
  const uniq = out.filter((a) => (a.pinfl && !seen.has(a.pinfl) ? (seen.add(a.pinfl), true) : false)).sort((a, b) => Number(a.reg) - Number(b.reg));

  const DATA = path.join(process.cwd(), 'data', 'palata-scan.json');
  fs.writeFileSync(DATA, JSON.stringify(uniq, null, 1));
  console.log(`WROTE ${uniq.length} arizas | empty name: ${uniq.filter((a) => !a.name).length} | no source: ${uniq.filter((a) => !a.source).length}`);
  console.log('sample:', uniq.slice(0, 3).map((a) => `${a.name} | ${a.address.slice(0, 40)}`).join('  ||  '));
})();
