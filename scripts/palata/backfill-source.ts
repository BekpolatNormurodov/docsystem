// One-off: the existing dataset was built before scans were retained, so its arizas
// have no `source`. Copy the known source PDFs into exports/palata-scans/ and tag each
// ariza with its source file + page range so per-ariza download works.
import fs from 'node:fs';
import path from 'node:path';
import { extractArizas } from '../../src/lib/palata-ocr';

const STORE = path.join(process.cwd(), 'exports', 'palata-scans');
const DL = '/Users/khurshid28/Downloads';
const OCR_ALL = process.argv[2]; // scratchpad/ocr-all.json (Scan_0003 page dump)

fs.mkdirSync(STORE, { recursive: true });
const copies: [string, string][] = [
  [`${DL}/Scan_0003.pdf`, 'scan_0003.pdf'],
  [`${DL}/ARIZA (42).pdf`, 'ariza_42.pdf'],
  [`${DL}/ARIZA (57).pdf`, 'ariza_57.pdf'],
];
for (const [src, name] of copies) {
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(STORE, name)); console.log('stored', name); }
  else console.log('MISSING', src);
}

// Map every Scan_0003 PINFL → its page range, from the OCR dump.
const scan0003 = new Map<string, string>();
if (OCR_ALL && fs.existsSync(OCR_ALL)) {
  for (const a of extractArizas(JSON.parse(fs.readFileSync(OCR_ALL, 'utf8')))) scan0003.set(a.pinfl, a.pages);
}
console.log('Scan_0003 pinfls:', scan0003.size);

const DATA = path.join(process.cwd(), 'data', 'palata-scan.json');
const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
let tagged = 0;
for (const r of rows) {
  if (scan0003.has(r.pinfl)) { r.source = 'scan_0003.pdf'; r.pages = scan0003.get(r.pinfl); tagged++; }
  else if (r.pinfl === '42005835310010') { r.source = 'ariza_42.pdf'; r.pages = '1-2'; tagged++; }
  else if (r.pinfl === '50608076520119') { r.source = 'ariza_57.pdf'; r.pages = '1-2'; tagged++; }
}
fs.writeFileSync(DATA, JSON.stringify(rows, null, 1));
console.log(`tagged ${tagged}/${rows.length} arizas with a source; ${rows.filter((r: any) => !r.source).length} without`);
