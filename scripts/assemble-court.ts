// Assemble the COMPLETE "5-sud BRIGHT" court package by merging the generated ofertas
// (OFERTA_CHIQDI, all firms) into each client folder, then zip + reconciliation report.
//
// Per-client oferta rule (no data loss, no duplicates):
//   • folder has NO oferta        → INJECT full generated set (all firms), named "oferta 1..N.pdf"
//   • generated >= existing count → REPLACE existing with generated (superset), backup old ones
//   • existing  >  generated      → KEEP existing (has closed-contract extras); append any
//                                    generated ofertas from firms NOT present in existing
//
// Run:  npx tsx scripts/assemble-court.ts            → DRY RUN (plan only, no writes)
//       npx tsx scripts/assemble-court.ts apply       → apply + zip + report
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import Excel from 'exceljs';

const SRC   = '/private/tmp/claude-501/-Users-khurshid28-Desktop-apps-docsystem/c1691449-e956-4d32-8c83-d27c0048a86f/scratchpad/sample_sud/5-sud BRIGHT';
const CH    = '/Users/khurshid28/Downloads/OFERTA_CHIQDI';
const OUTZIP= '/Users/khurshid28/Downloads/5-sud BRIGHT TAYYOR.zip';
const REPORT= '/Users/khurshid28/Downloads/5-sud_KAMOMAD_hisobot.xlsx';
const BACKUP= '/private/tmp/claude-501/-Users-khurshid28-Desktop-apps-docsystem/c1691449-e956-4d32-8c83-d27c0048a86f/scratchpad/court_backup';

const APPLY = process.argv[2] === 'apply';
const FIRM_ORDER: Record<string, number> = { '12842': 0, '06292': 1, '55890': 2 };
const norm = (s: string) => s.toUpperCase().replace(/[`'ʻʼ‘’]/g, "'").replace(/\s+/g, ' ').replace(/\.PDF$/, '').replace(/-/g, ' ').trim();

// ---- build generated-oferta map: normalized name -> sorted [{firm, ld, src}] ----
interface G { firm: string; ld: string; src: string }
const G = new Map<string, G[]>();
for (const firm of fs.readdirSync(CH)) {
  const fp = path.join(CH, firm); if (!fs.statSync(fp).isDirectory()) continue;
  const code = firm.split(' ')[0];
  for (const cl of fs.readdirSync(fp)) {
    const cp = path.join(fp, cl); if (!fs.statSync(cp).isDirectory()) continue;
    const m = cl.match(/^(\d{14})\s+(.*)$/); if (!m) continue;
    const k = norm(m[2]);
    if (!G.has(k)) G.set(k, []);
    for (const f of fs.readdirSync(cp).filter(x => /\.pdf$/i.test(x))) {
      const ld = (f.match(/_(\d+)\.pdf$/i) || [])[1] || f;
      G.get(k)!.push({ firm: code, ld, src: path.join(cp, f) });
    }
  }
}
for (const arr of G.values()) arr.sort((a, b) => (FIRM_ORDER[a.firm] ?? 9) - (FIRM_ORDER[b.firm] ?? 9) || (+a.ld || 0) - (+b.ld || 0));

const isOferta = (f: string) => /oferta/i.test(f) && /\.pdf$/i.test(f);
const hasReceipt = (files: string[]) => files.some(f => /receipt|td\d+_/i.test(f) || /^кимга/i.test(f));

interface Row { client: string; action: string; existing: number; generated: number; placed: number;
  firms: string; hasName: boolean; hasReceipt: boolean; hasAriza: boolean; note: string }
const rows: Row[] = [];
let injected = 0, replaced = 0, kept = 0, filesPlaced = 0;

const folders = fs.readdirSync(SRC).filter(f => fs.statSync(path.join(SRC, f)).isDirectory());
for (const folder of folders) {
  const fp = path.join(SRC, folder);
  const files = fs.readdirSync(fp);
  const nf = norm(folder);
  const existingOf = files.filter(isOferta);
  const g = G.get(nf) || [];
  const nameOk = files.some(f => norm(f) === nf) || files.some(f => /^кимга/i.test(f) && false); // name doc = <NAME>.pdf
  const arizaOk = files.some(f => /ariza|arizza/i.test(f));
  const recOk = hasReceipt(files);

  let action: string, placed = 0, note = '';
  if (g.length === 0) { action = 'NO_SOURCE'; note = 'CHIQDI da oferta topilmadi'; }
  else if (existingOf.length === 0) { action = 'INJECT'; placed = g.length; injected++; }
  else if (g.length >= existingOf.length) { action = 'REPLACE'; placed = g.length; replaced++; }
  else {
    action = 'KEEP'; kept++;
    const existFirms = new Set<string>(); // unknown from generic names → treat existing as BRIGHT-only unless g says otherwise
    const extraFirmG = g.filter(x => x.firm !== '12842'); // append non-BRIGHT generated (existing is BRIGHT manual set)
    placed = existingOf.length + extraFirmG.length;
    if (extraFirmG.length) note = `eski ${existingOf.length} saqlandi + ${extraFirmG.length} boshqa-firma oferta qo'shildi`;
    else note = `eski ${existingOf.length} saqlandi (yopiq shartnoma ofertalari ham bor)`;
  }
  filesPlaced += placed;

  const firmsCnt: Record<string, number> = {}; g.forEach(x => firmsCnt[x.firm] = (firmsCnt[x.firm] || 0) + 1);
  rows.push({ client: folder, action, existing: existingOf.length, generated: g.length, placed,
    firms: Object.entries(firmsCnt).map(([k, v]) => `${k}:${v}`).join(' '), hasName: nameOk, hasReceipt: recOk, hasAriza: arizaOk, note });

  if (APPLY && (action === 'INJECT' || action === 'REPLACE' || (action === 'KEEP' && note.includes('qo\'shildi')))) {
    // backup existing ofertas being removed
    if (action === 'REPLACE' && existingOf.length) {
      const bdir = path.join(BACKUP, folder); fs.mkdirSync(bdir, { recursive: true });
      for (const f of existingOf) fs.copyFileSync(path.join(fp, f), path.join(bdir, f));
      for (const f of existingOf) fs.rmSync(path.join(fp, f));
    }
    // choose source list
    const list = action === 'KEEP' ? g.filter(x => x.firm !== '12842') : g;
    const startIdx = action === 'KEEP' ? existingOf.length : 0;
    list.forEach((x, i) => {
      const dst = path.join(fp, `oferta ${startIdx + i + 1}.pdf`);
      fs.copyFileSync(x.src, dst);
    });
  }
}

// ---- summary ----
const missName = rows.filter(r => !r.hasName).map(r => r.client);
const missRec  = rows.filter(r => !r.hasReceipt).map(r => r.client);
const missAriza= rows.filter(r => !r.hasAriza).map(r => r.client);
const noSource = rows.filter(r => r.action === 'NO_SOURCE').map(r => r.client);
const keepList = rows.filter(r => r.action === 'KEEP');

console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log(`client folders           : ${folders.length}`);
console.log(`  INJECT (edi bo'sh)      : ${injected}`);
console.log(`  REPLACE (generatsiya)   : ${replaced}`);
console.log(`  KEEP   (eski saqlandi)  : ${kept}`);
console.log(`  NO_SOURCE               : ${noSource.length}`);
console.log(`jami oferta fayl joylandi : ${filesPlaced}`);
console.log(`\n--- KAMOMAD (to'ldirib bo'lmaydi, qo'lda kerak) ---`);
console.log(`  <ism>.pdf (da'vo) yo'q  : ${missName.length}  ${JSON.stringify(missName)}`);
console.log(`  receipt/kvitansiya yo'q : ${missRec.length}  ${JSON.stringify(missRec)}`);
console.log(`  ariza yo'q              : ${missAriza.length}  ${JSON.stringify(missAriza)}`);
console.log(`\n--- KEEP (eski oferta ko'p — ko'rib chiqing) ---`);
keepList.forEach(r => console.log(`  ${r.client}: eski ${r.existing} vs generatsiya ${r.generated} (${r.firms})`));

async function writeReport() {
  const wb = new Excel.Workbook();
  const s1 = wb.addWorksheet('Xulosa');
  s1.columns = [{ header: 'Ko\'rsatkich', key: 'k', width: 44 }, { header: 'Qiymat', key: 'v', width: 60 }];
  s1.addRows([
    { k: 'Mijoz papka (5-sud BRIGHT)', v: folders.length },
    { k: 'INJECT (oferta bo\'sh edi, qo\'shildi)', v: injected },
    { k: 'REPLACE (generatsiya bilan almashtirildi)', v: replaced },
    { k: 'KEEP (eski oferta saqlandi)', v: kept },
    { k: 'Jami oferta fayl joylandi', v: filesPlaced },
    { k: '--- KAMOMAD (qo\'lda to\'ldirish kerak) ---', v: '' },
    { k: '<ism>.pdf (da\'vo hujjati) yo\'q', v: missName.join(', ') || '—' },
    { k: 'receipt/kvitansiya yo\'q', v: missRec.join(', ') || '—' },
    { k: 'ariza yo\'q', v: missAriza.join(', ') || '—' },
  ]);
  s1.getRow(1).font = { bold: true };
  const s2 = wb.addWorksheet('Har mijoz');
  s2.columns = [
    { header: 'Mijoz', key: 'client', width: 40 }, { header: 'Amal', key: 'action', width: 10 },
    { header: 'Eski oferta', key: 'existing', width: 11 }, { header: 'Generatsiya', key: 'generated', width: 11 },
    { header: 'Joylandi', key: 'placed', width: 9 }, { header: 'Firmalar', key: 'firms', width: 20 },
    { header: 'ism.pdf', key: 'hasName', width: 8 }, { header: 'receipt', key: 'hasReceipt', width: 8 },
    { header: 'ariza', key: 'hasAriza', width: 7 }, { header: 'Izoh', key: 'note', width: 46 },
  ];
  rows.forEach(r => s2.addRow({ ...r, hasName: r.hasName ? '✓' : 'YO\'Q', hasReceipt: r.hasReceipt ? '✓' : 'YO\'Q', hasAriza: r.hasAriza ? '✓' : 'YO\'Q' }));
  s2.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(REPORT);
  console.log(`\nHisobot: ${REPORT}`);
}

async function zipIt() {
  await new Promise<void>((res, rej) => {
    const out = fs.createWriteStream(OUTZIP);
    const ar = archiver('zip', { zlib: { level: 6 } });
    out.on('close', () => res()); ar.on('error', rej); ar.pipe(out);
    ar.directory(SRC, '5-sud BRIGHT'); ar.finalize();
  });
  console.log(`ZIP: ${OUTZIP} (${(fs.statSync(OUTZIP).size / 1e6).toFixed(0)} MB)`);
}

(async () => {
  if (APPLY) { await writeReport(); await zipIt(); }
  else { await writeReport(); console.log('\n(DRY-RUN — hech narsa yozilmadi, faqat hisobot. Qo\'llash: `apply`)'); }
})().catch(e => { console.error(e); process.exit(1); });
