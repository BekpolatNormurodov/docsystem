// Standalone OFERTA generator straight from the two Downloads xlsx files (no DB):
//   • target list  ← "284 OFERTA.xlsx"  (Лист2: col C = 284 PINFL, col G = 95 names)
//   • contract data← "Ойдан ойга ўтган мижозлар.xlsx"  (full-CSV sheet «портфель 01.07»)
// Renders one oferta PDF per contract (summ_kr>0) with the app's OWN template/engine
// (fillOferta/renderOfertaPdf), grouped into per-client folders, zipped.
//
// Run:  npx tsx scripts/gen-oferta-manual.ts [limitClients]
//   no arg  → SAMPLE mode: first 3 clients, PDFs to scratch, logs computed fields.
//   a number→ that many clients.   "all" → everyone.
import fs from 'node:fs';
import path from 'node:path';
import Excel from 'exceljs';
import { chromium } from 'playwright';
import archiver from 'archiver';
import { renderOfertaPdf, ofertaFields, type OfertaFirm, type OfertaLoan } from '@/lib/oferta-pdf';
import { FIRMS_SEED } from '@/core/firms.seed';

const TARGET = '/Users/khurshid28/Downloads/284 OFERTA.xlsx';
const PORT = '/Users/khurshid28/Downloads/Ойдан ойга ўтган мижозлар.xlsx';
const PORT_SHEET = 'портфель 01.07';

const cv = (v: any) => (v && typeof v === 'object' ? (v.text ?? v.result ?? '') : v);
const nn = (s: any) => String(s || '').toUpperCase().replace(/[`'ʻʼ‘’]/g, "'").replace(/\s+/g, ' ').trim();
const safe = (s: string, n = 70) => (s || 'hujjat').replace(/[^\p{L}\p{N}._ ()'ʻ‘’-]+/gu, '_').trim().slice(0, n) || 'hujjat';

// CSV line parser + drop the unquoted comma-laden post_address (phone_mobile is the first quoted field)
function pc(l: string): string[] { const o: string[] = []; let c = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else { if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; } } o.push(c); return o; }
function sl(l: string): string[] { const i = l.indexOf(',"'); return i < 0 ? pc(l) : pc(l.slice(i + 1)); }

// indices in the split row (post_address dropped ⇒ documented index − 1)
const C = { client: 8, branch: 2, ld: 4, summ_kr: 9, rate: 16, date_to_cr: 17, date_close: 18, sumguarr: 20, nameguarr: 52, name_actu: 91, date_actu_close: 92, pinfl: 104 };

const isoDate = (s: any): Date | null => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const dmyDate = (s: any): Date | null => { const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; };

interface Contract { pinfl: string; client: string; branch: string; ld: string; summKr: number; rate: number; dateToCr: Date | null; maturity: Date | null; sumguarr: number; nameguarr: string; nameActu: string; }

async function readTargets() {
  const wb = new Excel.Workbook(); await wb.xlsx.readFile(TARGET);
  const l2 = wb.getWorksheet('Лист2')!;
  const pinflOrder: string[] = []; const pinflSet = new Set<string>(); const nameOrder: string[] = []; const nameSet = new Set<string>();
  for (let r = 2; r <= l2.rowCount; r++) {
    const p = String(cv(l2.getRow(r).getCell(3).value) || '').trim();
    if (/^\d{14}$/.test(p) && !pinflSet.has(p)) { pinflSet.add(p); pinflOrder.push(p); }
    const g = String(cv(l2.getRow(r).getCell(7).value) || '').trim();
    if (g) { const k = nn(g); if (!nameSet.has(k)) { nameSet.add(k); nameOrder.push(k); } }
  }
  return { pinflSet, nameSet, pinflOrder, nameOrder };
}

async function readPortfolio(pinflSet: Set<string>, nameSet: Set<string>) {
  const byPinfl = new Map<string, Contract[]>();
  const nameToPinfl = new Map<string, string>();
  const reader = new Excel.stream.xlsx.WorkbookReader(PORT, { worksheets: 'emit', entries: 'emit', sharedStrings: 'cache' });
  for await (const ws of reader) {
    if ((ws as any).name !== PORT_SHEET) { for await (const _ of ws) { } continue; }
    for await (const row of ws) {
      const raw = cv((row as any).getCell(1).value); if (!raw || typeof raw !== 'string') continue;
      const f = sl(raw); const pinfl = String(f[C.pinfl] || '').trim(); if (!/^\d{14}$/.test(pinfl)) continue;
      const client = String(f[C.client] || '').trim(); const nk = nn(client);
      const inTarget = pinflSet.has(pinfl) || nameSet.has(nk); if (!inTarget) continue;
      const summKr = parseFloat(f[C.summ_kr]); if (!(summKr > 0)) continue; // oferta only for real contracts
      const ct: Contract = {
        pinfl, client, branch: String(f[C.branch] || '').trim(), ld: String(f[C.ld] || '').trim(),
        summKr, rate: parseFloat(f[C.rate]) || 0, dateToCr: isoDate(f[C.date_to_cr]),
        maturity: dmyDate(f[C.date_actu_close]) || isoDate(f[C.date_close]),
        sumguarr: parseFloat(f[C.sumguarr]) || 0, nameguarr: String(f[C.nameguarr] || '').trim(), nameActu: String(f[C.name_actu] || '').trim(),
      };
      if (!byPinfl.has(pinfl)) byPinfl.set(pinfl, []);
      byPinfl.get(pinfl)!.push(ct);
      if (nameSet.has(nk) && !nameToPinfl.has(nk)) nameToPinfl.set(nk, pinfl);
    }
  }
  return { byPinfl, nameToPinfl };
}

function firmMap(): Map<string, OfertaFirm> {
  const m = new Map<string, OfertaFirm>();
  for (const s of FIRMS_SEED) m.set(s.code, { code: s.code, legalName: s.legalName ?? null, shortName: s.shortName ?? null, address: s.address ?? null, stir: s.stir ?? null, bankAccount: s.bankAccount ?? null, mfo: s.mfo ?? null });
  return m;
}

// Build the OfertaLoan the app's engine expects. dateClose carries the REAL maturity so
// loanMaturity() resolves the true 12/24/36-mo term (raw.date_actu_close here is a string,
// which excelSerialToDate can't parse → it falls back to dateClose, which we set correctly).
function toOfertaLoan(ct: Contract): OfertaLoan {
  return {
    ldId: ct.ld || null, summKr: ct.summKr, rate: ct.rate, dateToCr: ct.dateToCr, dateClose: ct.maturity,
    raw: { sumguarr: ct.sumguarr, nameguarr: ct.nameguarr, name_actu: ct.nameActu },
  };
}

// simple async pool
async function pool<T>(items: T[], size: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const idx = i++; await fn(items[idx], idx); } }));
}

async function main() {
  const arg = process.argv[2];
  const sample = !arg;
  const limit = arg === 'all' ? Infinity : sample ? 3 : Number(arg) || 3;
  const OUT = sample
    ? '/private/tmp/claude-501/-Users-khurshid28-Desktop-apps-docsystem/c1691449-e956-4d32-8c83-d27c0048a86f/scratchpad/oferta_sample'
    : '/Users/khurshid28/Downloads/OFERTA_CHIQDI';
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

  console.log('Ro\'yxat o\'qilmoqda…');
  const { pinflSet, nameSet, pinflOrder, nameOrder } = await readTargets();
  console.log(`  target: ${pinflOrder.length} PINFL + ${nameOrder.length} nom`);
  console.log('Portfel o\'qilmoqda (49MB)…');
  const { byPinfl, nameToPinfl } = await readPortfolio(pinflSet, nameSet);

  // ordered unique client pinfls: 284-list first, then 95-name-only that resolved to a NEW pinfl
  const seen = new Set<string>(); const clients: { pinfl: string; label: string }[] = [];
  for (const p of pinflOrder) if (byPinfl.has(p) && !seen.has(p)) { seen.add(p); clients.push({ pinfl: p, label: byPinfl.get(p)![0].client }); }
  for (const nm of nameOrder) { const p = nameToPinfl.get(nm); if (p && !seen.has(p)) { seen.add(p); clients.push({ pinfl: p, label: byPinfl.get(p)![0].client }); } }
  const scope = clients.slice(0, limit === Infinity ? clients.length : limit);

  const firms = firmMap();
  // Flat task list, foldered by FIRMA → PINFL(mijoz). Skip rate<=0 contracts (MAMBETOV ld 58611).
  interface Task { ct: Contract; folder: string; file: string; }
  const tasks: Task[] = []; let skipped = 0;
  for (const cl of scope) {
    for (const ct of byPinfl.get(cl.pinfl)!) {
      if (!(ct.rate > 0)) { skipped++; continue; } // rate=0 → oferta noto'g'ri, chiqarmaymiz
      const firm = firms.get(ct.branch);
      const firmFolder = `${ct.branch} ${firm?.shortName || ''}`.trim();
      const clientFolder = `${ct.pinfl} ${safe(ct.client, 50)}`;
      const folder = path.join(OUT, safe(firmFolder, 60), clientFolder);
      tasks.push({ ct, folder, file: `Oferta_${ct.branch}_${ct.ld || 'x'}.pdf` });
    }
  }
  console.log(`  unikal mijoz: ${scope.length} | oferta chiqadi: ${tasks.length} | chiqarilmaydi(rate=0): ${skipped}`);
  if (sample) tasks.forEach(t => { const fld = ofertaFields(toOfertaLoan(t.ct), firms.get(t.ct.branch) || {}, t.ct.client, t.ct.pinfl, 0); console.log(`  · ${t.ct.client} [${t.ct.branch}] summa=${fld.loan_amount} foiz=${fld.rate}% muddat=${fld.loan_term}oy to'liq=${fld.full_value} sug'urta=${fld.insurance}`); });

  const browser = await chromium.launch();
  let made = 0, failed = 0;
  try {
    await pool(tasks, sample ? 1 : 5, async (t) => {
      const firm = firms.get(t.ct.branch) || {};
      try {
        const pdf = await renderOfertaPdf(toOfertaLoan(t.ct), firm, browser, t.ct.client, t.ct.pinfl, 0);
        fs.mkdirSync(t.folder, { recursive: true });
        fs.writeFileSync(path.join(t.folder, t.file), pdf);
        made++;
        if (!sample && made % 50 === 0) console.log(`  …${made}/${tasks.length} PDF`);
      } catch (e) { failed++; console.error('  PDF xato:', t.ct.client, t.ct.ld, (e as Error).message); }
    });
  } finally { await browser.close(); }

  console.log(`\nTayyor: ${made} PDF${failed ? `, ${failed} xato` : ''} → ${OUT}`);
  if (!sample) {
    const zipPath = OUT + '.zip';
    await new Promise<void>((res, rej) => {
      const out = fs.createWriteStream(zipPath); const ar = archiver('zip', { zlib: { level: 6 } });
      out.on('close', () => res()); ar.on('error', rej); ar.pipe(out); ar.directory(OUT, false); ar.finalize();
    });
    console.log(`ZIP: ${zipPath} (${(fs.statSync(zipPath).size / 1e6).toFixed(1)} MB)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
