// Regenerate data/palata-scan.json from a full OCR page dump using the LIB extractor
// (keeps the dataset consistent with what the web upload path produces).
import fs from 'node:fs';
import { extractArizas, mergeArizas } from '../../src/lib/palata-ocr';

(async () => {
  const pages = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const raw = extractArizas(pages);
  // Dedup by PINFL (a client can appear twice in one scan), keep page order.
  const seen = new Set<string>();
  const ar = raw.filter((a) => (a.pinfl && !seen.has(a.pinfl) ? (seen.add(a.pinfl), true) : false)).sort((a, b) => Number(a.reg) - Number(b.reg));
  console.log('raw groups:', raw.length, '→ unique:', ar.length);
  const per = new Map<string, number>();
  for (const a of ar) per.set(a.firmKey || '?', (per.get(a.firmKey || '?') || 0) + 1);
  console.log('extracted:', ar.length, '| per firm:', [...per].map(([k, v]) => `${k}=${v}`).join(' '));
  console.log('invalid pinfl:', ar.filter((a) => !/^\d{14}$/.test(a.pinfl)).length);
  console.log('empty name:', ar.filter((a) => !a.name).length);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(process.cwd() + '/data/palata-scan.json', JSON.stringify(ar, null, 1));
    console.log('WROTE data/palata-scan.json with', ar.length, 'arizas');
  }
})();
