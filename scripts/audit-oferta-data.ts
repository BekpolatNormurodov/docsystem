// Precise per-contract completeness "razbor" of the OFERTA data for the 340 target clients,
// straight from the two Downloads xlsx. Flags every contract whose oferta fields are chala,
// prints a summary, and writes an Excel report (Summary + Chala list) to Downloads.
import fs from 'node:fs';
import Excel from 'exceljs';

const TARGET = '/Users/khurshid28/Downloads/284 OFERTA.xlsx';
const PORT = '/Users/khurshid28/Downloads/Ойдан ойга ўтган мижозлар.xlsx';
const PORT_SHEET = 'портфель 01.07';
const OUT = '/Users/khurshid28/Downloads/OFERTA_data_audit.xlsx';

const cv = (v: any) => (v && typeof v === 'object' ? (v.text ?? v.result ?? '') : v);
const nn = (s: any) => String(s || '').toUpperCase().replace(/[`'ʻʼ‘’]/g, "'").replace(/\s+/g, ' ').trim();
function pc(l: string): string[] { const o: string[] = []; let c = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else { if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; } } o.push(c); return o; }
function sl(l: string): string[] { const i = l.indexOf(',"'); return i < 0 ? pc(l) : pc(l.slice(i + 1)); }
const C = { client: 8, branch: 2, ld: 4, summ_kr: 9, rate: 16, date_to_cr: 17, date_close: 18, sumguarr: 20, nameguarr: 52, date_actu_close: 92, pinfl: 104 };
const isoOK = (s: any) => /^\d{4}-\d{2}-\d{2}/.test(String(s || ''));
const dmyOK = (s: any) => /^\d{2}\.\d{2}\.\d{4}/.test(String(s || ''));
const isoDate = (s: any): Date | null => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const dmyDate = (s: any): Date | null => { const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; };
const SEED_BRANCHES = new Set(['12842', '06292', '14276', '55890', '31685', '05557', '31734', '55899', '07634']);

interface Row { pinfl: string; client: string; branch: string; ld: string; summKr: number; rate: number; dcrOK: boolean; matOK: boolean; term: number | null; sumguarr: number; nameguarr: string; issues: string[]; }

async function main() {
  // targets
  const wt = new Excel.Workbook(); await wt.xlsx.readFile(TARGET);
  const l2 = wt.getWorksheet('Лист2')!;
  const pset = new Set<string>(), nset = new Set<string>();
  for (let r = 2; r <= l2.rowCount; r++) { const p = String(cv(l2.getRow(r).getCell(3).value) || '').trim(); if (/^\d{14}$/.test(p)) pset.add(p); const g = String(cv(l2.getRow(r).getCell(7).value) || '').trim(); if (g) nset.add(nn(g)); }

  const rows: Row[] = [];
  const reader = new Excel.stream.xlsx.WorkbookReader(PORT, { worksheets: 'emit', entries: 'emit', sharedStrings: 'cache' });
  for await (const ws of reader) {
    if ((ws as any).name !== PORT_SHEET) { for await (const _ of ws) { } continue; }
    for await (const row of ws) {
      const raw = cv((row as any).getCell(1).value); if (!raw || typeof raw !== 'string') continue;
      const f = sl(raw); const pinfl = String(f[C.pinfl] || '').trim(); if (!/^\d{14}$/.test(pinfl)) continue;
      const client = String(f[C.client] || '').trim();
      if (!(pset.has(pinfl) || nset.has(nn(client)))) continue;
      const summKr = parseFloat(f[C.summ_kr]) || 0;
      const rate = parseFloat(f[C.rate]) || 0;
      const dcrOK = isoOK(f[C.date_to_cr]); const matOK = dmyOK(f[C.date_actu_close]) || isoOK(f[C.date_close]);
      const sumguarr = parseFloat(f[C.sumguarr]) || 0;
      const start = isoDate(f[C.date_to_cr]); const mat = dmyDate(f[C.date_actu_close]) || isoDate(f[C.date_close]);
      const term = start && mat && mat > start ? Math.round((mat.getTime() - start.getTime()) / 86400000 / 30.4375) : null;
      const branch = String(f[C.branch] || '').trim();
      const issues: string[] = [];
      if (!(summKr > 0)) issues.push('summ_kr=0/bo\'sh');
      if (!(rate > 0)) issues.push('rate=0/bo\'sh');
      if (!dcrOK) issues.push('date_to_cr yo\'q');
      if (!matOK) issues.push('yopilish sanasi yo\'q');
      if (!(sumguarr > 0)) issues.push('sug\'urta(sumguarr)=0');
      if (branch && !SEED_BRANCHES.has(branch)) issues.push('firma seed\'da yo\'q: ' + branch);
      if (term !== null && ![12, 24, 36].includes(term)) issues.push('g\'ayrioddiy muddat: ' + term + 'oy');
      if (rate > 0 && ![53, 54, 62].includes(rate)) issues.push('g\'ayrioddiy foiz: ' + rate);
      rows.push({ pinfl, client, branch, ld: String(f[C.ld] || '').trim(), summKr, rate, dcrOK, matOK, term, sumguarr, nameguarr: String(f[C.nameguarr] || '').trim(), issues });
    }
  }

  const withSumm = rows.filter(r => r.summKr > 0);
  // HARD = blocks/corrupts the oferta; SOFT = fills but odd/derived
  const HARD = new Set(['rate=0/bo\'sh', 'date_to_cr yo\'q', 'yopilish sanasi yo\'q', 'summ_kr=0/bo\'sh']);
  const hard = rows.filter(r => r.issues.some(i => [...HARD].some(h => i.startsWith(h.split('=')[0].split(':')[0]))));
  const rate0 = withSumm.filter(r => !(r.rate > 0));
  const noDcr = withSumm.filter(r => !r.dcrOK);
  const noMat = withSumm.filter(r => !r.matOK);
  const noGuar = withSumm.filter(r => !(r.sumguarr > 0));
  const oddTerm = withSumm.filter(r => r.term !== null && ![12, 24, 36].includes(r.term));
  const oddRate = withSumm.filter(r => r.rate > 0 && ![53, 54, 62].includes(r.rate));
  const badBranch = withSumm.filter(r => r.branch && !SEED_BRANCHES.has(r.branch));
  const summ0 = rows.filter(r => !(r.summKr > 0));
  const anyIssue = withSumm.filter(r => r.issues.length > 0);

  const P = (n: number) => `${n}/${withSumm.length}`;
  console.log('=== OFERTA DATA RAZBOR — 340 mijoz / target kontraktlar ===');
  console.log('kontrakt (summ_kr>0):', withSumm.length, ' | summ_kr=0 (chiqmaydi):', summ0.length);
  console.log('\nHARD (oferta buziladi):');
  console.log('  rate=0/bo\'sh        :', P(rate0.length));
  console.log('  date_to_cr yo\'q     :', P(noDcr.length));
  console.log('  yopilish sanasi yo\'q:', P(noMat.length));
  console.log('\nSOFT (chiqadi, lekin e\'tibor):');
  console.log('  sug\'urta sumguarr=0 :', P(noGuar.length), '(bunda 19% fallback ishlaydi)');
  console.log('  g\'ayrioddiy muddat  :', P(oddTerm.length), oddTerm.length ? '('+[...new Set(oddTerm.map(r=>r.term+'oy'))].join(',')+')' : '');
  console.log('  g\'ayrioddiy foiz    :', P(oddRate.length), oddRate.length ? '('+[...new Set(oddRate.map(r=>r.rate+'%'))].join(',')+')' : '');
  console.log('  firma seed\'da yo\'q  :', P(badBranch.length), badBranch.length ? '('+[...new Set(badBranch.map(r=>r.branch))].join(',')+')' : '');
  console.log('\nJAMI biror kamchiligi bor kontrakt:', anyIssue.length, '/', withSumm.length, ' — TOZA:', withSumm.length - anyIssue.length);

  if (rate0.length) { console.log('\nrate=0 kontraktlar:'); rate0.forEach(r => console.log('  ', r.pinfl, r.client, '| ld', r.ld, '| summa', r.summKr)); }
  if (noDcr.length) { console.log('\ndate_to_cr yo\'q:'); noDcr.slice(0, 20).forEach(r => console.log('  ', r.pinfl, r.client, '| ld', r.ld)); }
  if (noMat.length) { console.log('\nyopilish sanasi yo\'q:'); noMat.slice(0, 20).forEach(r => console.log('  ', r.pinfl, r.client, '| ld', r.ld)); }

  // ---- Excel report ----
  const wb = new Excel.Workbook();
  const s1 = wb.addWorksheet('Xulosa');
  s1.columns = [{ header: 'Ko\'rsatkich', key: 'k', width: 40 }, { header: 'Qiymat', key: 'v', width: 16 }];
  s1.addRows([
    { k: 'Unikal mijoz', v: new Set(withSumm.map(r => r.pinfl)).size },
    { k: 'Kontrakt (summ_kr>0) = oferta soni', v: withSumm.length },
    { k: 'summ_kr=0 (chiqmaydi)', v: summ0.length },
    { k: 'TOZA kontrakt (kamchiliksiz)', v: withSumm.length - anyIssue.length },
    { k: '--- HARD (oferta buziladi) ---', v: '' },
    { k: 'rate=0 / bo\'sh', v: rate0.length },
    { k: 'date_to_cr yo\'q', v: noDcr.length },
    { k: 'yopilish sanasi yo\'q', v: noMat.length },
    { k: '--- SOFT (chiqadi, e\'tibor) ---', v: '' },
    { k: 'sug\'urta sumguarr=0 (19% fallback)', v: noGuar.length },
    { k: 'g\'ayrioddiy muddat (12/24/36 emas)', v: oddTerm.length },
    { k: 'g\'ayrioddiy foiz (53/54/62 emas)', v: oddRate.length },
    { k: 'firma seed\'da yo\'q', v: badBranch.length },
  ]);
  s1.getRow(1).font = { bold: true };

  const s2 = wb.addWorksheet('Chala kontraktlar');
  s2.columns = [
    { header: 'PINFL', key: 'pinfl', width: 18 }, { header: 'Mijoz', key: 'client', width: 38 },
    { header: 'Firma', key: 'branch', width: 10 }, { header: 'Shartnoma(ld)', key: 'ld', width: 12 },
    { header: 'summ_kr', key: 'summ', width: 14 }, { header: 'foiz', key: 'rate', width: 8 },
    { header: 'muddat(oy)', key: 'term', width: 11 }, { header: 'sug\'urta', key: 'guar', width: 14 },
    { header: 'KAMCHILIK', key: 'iss', width: 50 },
  ];
  for (const r of anyIssue.sort((a, b) => (b.issues.length - a.issues.length))) s2.addRow({ pinfl: r.pinfl, client: r.client, branch: r.branch, ld: r.ld, summ: r.summKr, rate: r.rate, term: r.term, guar: r.sumguarr, iss: r.issues.join('; ') });
  s2.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(OUT);
  console.log('\nHisobot Excel:', OUT);
}
main().catch(e => { console.error(e); process.exit(1); });
