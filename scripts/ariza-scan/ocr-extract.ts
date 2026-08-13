// Turn the Windows-OCR page dump (scratchpad/ocr-all.json — [{page,text}]) into the
// palata-scan dataset. Each ariza = a HEADER page (the only page with a "Jshshir:"
// PINFL line) + the following debt page(s). We extract firma + PINFL (the fields the
// panel matches on) plus best-effort name/address/phone. Writes data/palata-scan.json.
import fs from 'node:fs';
import path from 'node:path';

interface OcrPage { page: number; text: string }
interface Ariza { reg: string; pages: string; name: string; pinfl: string; firmKey: string; firm: string; address: string; phone: string }

const FIRM_KEYS: [RegExp, string][] = [
  [/BRIGHT/i, 'BRIGHT'], [/URBAN/i, 'URBAN'], [/COMMUNITY/i, 'COMMUNITY'],
  [/MUVAFFAQIYAT/i, 'MUVAFFAQIYAT'], [/FUNDFLOW/i, 'FUNDFLOW'],
];
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// The PINFL line: "Jshshir: 51608016520095". OCR may split the 14 digits with spaces,
// so grab the labelled run and strip non-digits, then take the first 14.
function pinflOf(text: string): string {
  const m = text.match(/J[a-z]*sh[a-z]*ir[^\d]{0,8}((?:\d[\s]?){13,16}\d)/i)
        || text.match(/Jshshir[^\d]{0,8}(\d[\d\s]{12,18}\d)/i);
  if (m) { const d = m[1].replace(/\D/g, ''); if (d.length >= 14) return d.slice(0, 14); }
  return '';
}
const hasPinfl = (text: string) => pinflOf(text) !== '';

function firmOf(text: string): { firm: string; firmKey: string } {
  const hit = FIRM_KEYS.find(([re]) => re.test(text));
  const q = text.match(/"([^"]*(?:FINANCING|SOLUTIONS|MICROFINANCE|MIKROMOLIYA)[^"]*)"/i);
  return { firm: q ? clean(q[1]) : '', firmKey: hit ? hit[1] : '' };
}

// Name + address sit between the firm's STIR (…, STIR: 311 976 765) and "Jshshir:".
// The header has TWO STIR lines (Palata's + the firm's); the qarzdor block follows
// the LAST one, so the greedy `.*` prefix consumes up to it.
function nameAddrOf(text: string): { name: string; address: string } {
  const t = clean(text);
  const m = t.match(/.*STIR[:\s]*[\d ]{6,}\s+(.+?)\s+J[a-z]*sh[a-z]*ir/i);
  const block = m ? clean(m[1]) : '';
  // Address begins at the first place-type token (tumani/shahar/MFY/… incl. common OCR misreads).
  const am = block.match(/\s(\S*\s*(?:tumani|tuman|tillilani|shahri|shahar|viloyati|viloyat|MFY|QFY)\b.*)$/i);
  let name = am ? clean(block.slice(0, am.index)) : block;
  let address = am ? clean(am[1]).replace(/\s*J[a-z]*sh[a-z]*ir.*$/i, '') : '';
  // Strip leading OCR junk ("(", "518.", stray digits) so the name starts at a letter.
  name = name.replace(/^[^A-Za-zА-Яа-яЎўҒғҚқҲҳ']+/u, '').trim();
  // If the qarzdor STIR line was misread, the greedy match can capture the firm block — drop it.
  if (/FINANCING|MIKROMOLIYA|MCHJ|\bMMT\b/i.test(name)) name = '';
  return { name, address };
}
function phoneOf(text: string): string {
  const m = text.match(/Tel[:\s]*(\+?\d[\d ]{6,})/i);
  return m ? m[1].replace(/\s/g, '') : '';
}

const src = process.argv[2] || path.join(process.cwd(), '..', 'scratchpad', 'ocr-all.json');
const pages: OcrPage[] = JSON.parse(fs.readFileSync(src, 'utf8'));
pages.sort((a, b) => a.page - b.page);

// Group pages into arizas by header boundary (a page that carries a Jshshir PINFL).
const groups: { start: number; texts: string[] }[] = [];
let cur: { start: number; texts: string[] } | null = null;
for (const p of pages) {
  if (hasPinfl(p.text)) { if (cur) groups.push(cur); cur = { start: p.page, texts: [p.text] }; }
  else if (cur) cur.texts.push(p.text);
}
if (cur) groups.push(cur);

const arizas: Ariza[] = groups.map((g) => {
  const header = g.texts[0];
  const { firm, firmKey } = firmOf(header);
  const { name, address } = nameAddrOf(header);
  const end = g.start + g.texts.length - 1;
  return { reg: String(g.start + 1), pages: `${g.start + 1}-${end + 1}`, name, pinfl: pinflOf(header), firmKey, firm, address, phone: phoneOf(header) };
});

// Dedup by PINFL (keep first), sort by page order.
const seen = new Set<string>();
const out: Ariza[] = [];
for (const a of arizas) { if (a.pinfl && !seen.has(a.pinfl)) { seen.add(a.pinfl); out.push(a); } }
out.sort((a, b) => Number(a.reg) - Number(b.reg));

const perFirm = new Map<string, number>();
for (const a of out) perFirm.set(a.firmKey || '?', (perFirm.get(a.firmKey || '?') || 0) + 1);
const noPinfl = arizas.filter((a) => !a.pinfl).length;
const noFirm = out.filter((a) => !a.firmKey).length;

const target = path.join(process.cwd(), 'data', 'palata-scan.json');
if (process.argv.includes('--write')) {
  fs.writeFileSync(target, JSON.stringify(out, null, 1));
  console.log('WROTE', target);
}

console.log('groups(header pages):', groups.length, '| arizas w/ PINFL:', out.length, '| dropped(no pinfl):', noPinfl, '| no firmKey:', noFirm);
console.log('per firm:', [...perFirm.entries()].map(([k, v]) => `${k}=${v}`).join('  '));
console.log('\nfirst 5:');
for (const a of out.slice(0, 5)) console.log(` p${a.pages}  ${a.firmKey.padEnd(12)} ${a.pinfl}  ${a.name} | ${a.address}`);
console.log('\nlast 3:');
for (const a of out.slice(-3)) console.log(` p${a.pages}  ${a.firmKey.padEnd(12)} ${a.pinfl}  ${a.name}`);
