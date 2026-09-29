// DB-free talabnoma builder for the per-firm target lists (2026-09-29 batch):
//   6 ta ro'yxat (<firma> talabnoma.xlsx — PNFL, FIO, …, MKO) + портфель.xlsx (25.09, kredit
//   ma'lumoti; post_address YO'Q). Manzil: 25.08 snapshot (tizim importi — post_address+viloyat+tuman),
//   zaxira — портфель (3).xlsx (30.07). Har ro'yxat = o'sha firmaning talabnomasi: kishining FAQAT shu
//   firmadagi kreditlari guruhlanadi (buildTalabnomaRows — tizimdagi reyestr bilan bir xil shakl).
// Kirish JSON'lari (Excel'lardan oldindan ajratilgan): lists.json, port_0925*.json, port_0730*.json,
// addr_db3_all.json ({pinfl: [{branch, post, region, distr}]}).
//   npx tsx scripts/tlb-manual-build.ts <jsonDir> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { buildTalabnomaRows, talabnomaExcelBuffer, type TalabnomaLoan, type TalabnomaRow } from '../src/lib/hippo/talabnoma-excel';
import { resolveHippoRegionArea, resolveAreaMatch, regionName, areaName, HIPPO_REGIONS } from '../src/core/hippo-regions';
import { normalizeAddress } from '../src/core/address';
import { computeTotalDebt } from '../src/core/portfolio';

const [jsonDir, outDir] = process.argv.slice(2);
if (!jsonDir || !outDir) { console.error('usage: tlb-manual-build.ts <jsonDir> <outDir>'); process.exit(1); }

export const TLB_FIRMS: Record<string, { code: string; name: string; stir: string }> = {
  bright: { code: '12842', name: 'BRIGHT', stir: '311976765' },
  community: { code: '55890', name: 'COMMUNITY', stir: '312191604' },
  urban: { code: '06292', name: 'URBAN', stir: '311943592' },
  muvaffaqiyat: { code: '05557', name: 'MUVAFFAQIYAT', stir: '311939991' },
  zaymly: { code: '31685', name: 'ZAYMLY', stir: '312500154' },
  fundflow: { code: '14276', name: 'FUNDFLOW', stir: '311979413' },
};
// UTC yarim tun — Mac (UTC+5) ham, prod konteyner (UTC) ham bir xil kunni o'qiydi (exceljs UTC yozadi).
const DOC_DATE = new Date(Date.UTC(2026, 8, 29)); // talabnoma sanasi — 29.09.2026

type Row = Record<string, unknown>;
interface ListRow { pinfl: string; fio: string; viloyat: string | null; tuman: string | null; days: number | null }
interface AddrRow { branch: string; post: string; region: string; distr: string; src: string }
const canon = (c: unknown) => String(c ?? '').trim().replace(/^0+/, '') || '0';
const s = (v: unknown) => (v == null ? '' : String(v).trim());
const digits = (v: unknown) => s(v).replace(/\.0$/, '').replace(/\D/g, '');
const toDate = (v: unknown): Date | null => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v)); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const readJson = <T>(f: string, dflt: T): T => (fs.existsSync(path.join(jsonDir, f)) ? JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8')) : dflt);

const lists = readJson<Record<string, ListRow[]>>('lists.json', {});
const byPinfl = <T>(rows: T[], pin: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const p = pin(r); if (!p) continue; (m.get(p) ?? m.set(p, []).get(p)!).push(r); }
  return m;
};
const p25 = [...readJson<{ rows: Row[] }>('port_0925.json', { rows: [] }).rows, ...readJson<{ rows: Row[] }>('port_0925_ff.json', { rows: [] }).rows];
const p07 = [...readJson<{ rows: Row[] }>('port_0730.json', { rows: [] }).rows, ...readJson<{ rows: Row[] }>('port_0730_ff.json', { rows: [] }).rows];
const loans25 = byPinfl(p25, (r) => digits(r.pinfl));
// Manzil manbalari, ustuvorlik bo'yicha: 25.08 snapshot (tizim importi) → 30.07 portfel.
const db3 = readJson<Record<string, Omit<AddrRow, 'src'>[]>>('addr_db3_all.json', {});
const addrDb = new Map<string, AddrRow[]>(Object.entries(db3).map(([p, rs]) => [p, rs.map((r) => ({ ...r, src: '25.08' }))]));
const addr07 = byPinfl<AddrRow>(p07.map((r) => ({ branch: s(r.branch), post: s(r.post_address), region: s(r.name), distr: s(r.distr_name), src: '30.07', pinfl: digits(r.pinfl) } as AddrRow & { pinfl: string })), (r) => (r as AddrRow & { pinfl: string }).pinfl);

// Eng to'liq manzil: avval shu firma qatorlari (25.08 → 30.07), keyin istalgan firma (25.08 → 30.07).
function addressFor(pinfl: string, code: string): (AddrRow & { sameFirm: boolean }) | null {
  const fullest = (rs: AddrRow[]) => rs.filter((r) => r.post).sort((a, b) => b.post.length - a.post.length)[0];
  const sources = [addrDb.get(pinfl) ?? [], addr07.get(pinfl) ?? []];
  for (const same of [true, false]) {
    for (const src of sources) {
      const r = fullest(same ? src.filter((x) => canon(x.branch) === canon(code)) : src);
      if (r) return { ...r, sameFirm: same };
    }
  }
  return null;
}

// Viloyat+tuman → hippo ID. Asosiy juftlik aniqlanmasa: boshqa tuman nomlari bilan, keyin tumanni
// BARCHA viloyatlar ichidan aniq (exact) qidiramiz (masalan «Тош обл» + «ЧИЛОНЗОР ТУМАНИ» → Toshkent sh.).
function resolveGeo(region: string, districts: string[]) {
  for (const d of districts.filter(Boolean)) {
    const r = resolveHippoRegionArea(region, d);
    if (r.regionId && r.areaId) return { ...r, district: d };
  }
  for (const d of districts.filter(Boolean)) {
    for (const reg of HIPPO_REGIONS) {
      const m = resolveAreaMatch(reg.id, d);
      if (m.id && (m.confidence === 'exact' || m.confidence === 'override')) return { regionId: reg.id, areaId: m.id, areaConfidence: m.confidence, district: d };
    }
  }
  return { regionId: 0, areaId: 0, areaConfidence: 'none' as const, district: districts[0] ?? '' };
}

// «Ideal» manzil: pochta tartibida VILOYAT boshida (tizim normalizeAddress'i yangi importdagi
// «Самарканд»/«Тош обл» kabi qisqa viloyat nomlarini tanimaydi → viloyat tushib qolardi) va manba
// to'ldiruvchilari (bank ABS «D. RS» → «R S», «UY:0», yakuniy «-») tozalangan.
const VILOYAT: Record<number, string> = {
  1: 'Toshkent shahri', 2: 'Toshkent viloyati', 3: 'Samarqand viloyati', 4: 'Jizzax viloyati', 5: 'Sirdaryo viloyati',
  6: 'Fargʻona viloyati', 7: 'Andijon viloyati', 8: 'Namangan viloyati', 9: 'Qashqadaryo viloyati', 10: 'Surxondaryo viloyati',
  11: 'Buxoro viloyati', 12: 'Navoiy viloyati', 13: 'Qoraqalpogʻiston Respublikasi', 14: 'Xorazm viloyati',
};
function polishAddress(latin: string, regionId: number): string {
  let a = ` ${latin} `
    .replace(/(^|[\s,])R\s?S(?=[\s,]|$)/g, '$1')   // «R S» / «RS» — bo'sh uy raqami to'ldiruvchisi
    .replace(/(\d+[A-Za-z]?)\s+U[iy](?=[\s,]|$)/g, '$1-uy') // «90 UY» → «90-uy» (aks holda «90 Уи»)
    .replace(/(^|[\s,])0{1,3}-uy\b/gi, '$1')         // «UY:0» / «00» → to'ldiruvchi, uy raqami emas
    .replace(/\bKo\s?Chasi\b/gi, 'koʻchasi')          // «KO'CHASI» apostrofsiz → «Ko Chasi»
    .replace(/\bKishlogi\b/gi, 'qishlogʻi')
    .replace(/(^|\s)Kfi(?=[\s,]|$)/gi, '$1QFY').replace(/(^|\s)Shfi(?=[\s,]|$)/gi, '$1ShFY').replace(/(^|\s)Fi(?=[\s,]|$)/g, '$1FY')
    .replace(/koʻchasi\s+(\d+[A-Za-z]?)\s*$/, 'koʻchasi, $1-uy') // «… koʻchasi 6» → «… koʻchasi, 6-uy»
    .replace(/(,\s*)+-?\s*$/, '')                   // yakuniy «, -»
    .replace(/\s+-\s*$/, '')
    .replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/,{2,}/g, ',').trim().replace(/^,|,$/g, '').trim();
  const vil = VILOYAT[regionId];
  if (vil && !a.toLowerCase().startsWith(vil.toLowerCase())) a = a ? `${vil}, ${a}` : vil;
  return a;
}

interface Flag { firm: string; pinfl: string; fio: string; issue: string }
interface Meta { addrSrc: string; days: number | null; geo: string }
const flags: Flag[] = [];
const summary: Record<string, unknown>[] = [];
const allOut: { firm: string; rows: TalabnomaRow[]; meta: Map<string, Meta> }[] = [];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [key, firm] of Object.entries(TLB_FIRMS)) {
    const list = lists[key];
    if (!list) continue;
    const loans: TalabnomaLoan[] = [];
    const meta = new Map<string, Meta>();
    let noLoan = 0;
    for (const p of list) {
      const mine = (loans25.get(p.pinfl) ?? []).filter((r) => canon(r.branch) === canon(firm.code));
      if (!mine.length) { noLoan++; flags.push({ firm: firm.name, pinfl: p.pinfl, fio: p.fio, issue: '25.09 portfelda shu firmada kredit yoʻq — talabnoma yoʻq' }); continue; }
      const a = addressFor(p.pinfl, firm.code);
      const region = a?.region || s(p.viloyat);
      const geo = resolveGeo(region, [a?.distr ?? '', s(mine[0].distr_name), s(p.tuman)]);
      const addrUz = polishAddress(normalizeAddress(region, geo.district, a?.post ?? null), geo.regionId);
      meta.set(p.pinfl, { addrSrc: a ? `${a.src}${a.sameFirm ? '' : ' (boshqa firma)'}` : 'YOʻQ', days: p.days, geo: geo.areaConfidence });
      if (!a) flags.push({ firm: firm.name, pinfl: p.pinfl, fio: p.fio, issue: 'Koʻcha/uy manzili topilmadi — faqat viloyat/tuman' });
      if (geo.areaConfidence === 'fuzzy') flags.push({ firm: firm.name, pinfl: p.pinfl, fio: p.fio, issue: `Tuman taxminiy moslandi: «${geo.district}» → «${areaName(geo.areaId)}»` });
      for (const r of mine) {
        loans.push({
          pinfl: p.pinfl, branchCode: firm.code, clientName: s(r.client_name) || p.fio,
          postAddress: a?.post ?? null, postAddressUz: addrUz || null,
          // buildTalabnomaRows region/area'ni shu ikkisidan qayta hisoblaydi — aniqlangan juftlikni beramiz.
          regionName: regionName(geo.regionId) || region,
          ldId: digits(r.ld_id), dateToCr: toDate(r.date_to_cr),
          summKr: Number(r.summ_kr) || 0, totalDebt: computeTotalDebt(r), raw: { distr_name: areaName(geo.areaId) || geo.district },
          // Qarz qismlari → reyestrdagi «overdue_debt» (muddati o'tgan asosiy + foiz; talabnoma-excel.ts).
          debtOverduePrincipal: Number(r.summ_ostpr_ze) || 0, debtOverdueInterest: Number(r.sumnachpr_eqv) || 0,
        });
      }
    }
    const rows = buildTalabnomaRows(loans, DOC_DATE).filter((r) => r.total_debt > 0);
    for (const r of rows) {
      if (!r.region || !r.area) flags.push({ firm: firm.name, pinfl: r.pinfl ?? '', fio: r.receiver, issue: `Viloyat/tuman aniqlanmadi (region=${r.region}, area=${r.area}) — hippo rad etadi` });
    }
    fs.writeFileSync(path.join(outDir, `${firm.name}_reyestr.xlsx`), await talabnomaExcelBuffer(rows));
    fs.writeFileSync(path.join(outDir, `${firm.name}_rows.json`), JSON.stringify({ firm, docDate: DOC_DATE, rows }));
    summary.push({
      firm: firm.name, code: firm.code, listed: list.length, talabnoma: rows.length, noLoanAtFirm: noLoan,
      contracts: loans.length, debtSum: rows.reduce((t, r) => t + r.total_debt, 0),
      noStreet: [...meta.values()].filter((m) => m.addrSrc === 'YOʻQ').length,
      fuzzyArea: [...meta.values()].filter((m) => m.geo === 'fuzzy').length,
      badGeo: rows.filter((r) => !r.region || !r.area).length,
    });
    allOut.push({ firm: firm.name, rows, meta });
  }

  // Ko'rik uchun bitta umumiy Excel (hippo-import emas): firma, FIO, PINFL, manzil, shartnomalar, summa.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Talabnoma — hammasi');
  ws.columns = [
    { header: 'Firma', key: 'firm', width: 14 }, { header: '№', key: 'cid', width: 14 },
    { header: 'Qarzdor FISH', key: 'fio', width: 36 }, { header: 'PINFL', key: 'pinfl', width: 16 },
    { header: 'Manzil', key: 'addr', width: 60 }, { header: 'Manzil manbasi', key: 'src', width: 18 },
    { header: 'Viloyat', key: 'reg', width: 22 }, { header: 'Tuman/Shahar', key: 'area', width: 22 },
    { header: 'Shartnoma raqami', key: 'cnum', width: 20 }, { header: 'Shartnoma sanasi', key: 'cdate', width: 14 },
    { header: 'Kredit summasi', key: 'loan', width: 16 }, { header: 'Jami qarzdorlik', key: 'debt', width: 16 },
    { header: "Muddati o'tgan jami qarzdorlik", key: 'overdue', width: 20 },
    { header: 'Kun (roʻyxat)', key: 'days', width: 10 },
  ];
  for (const g of allOut) for (const r of g.rows) {
    const m = g.meta.get(r.pinfl ?? '');
    ws.addRow({
      firm: g.firm, cid: r.contract_id, fio: r.receiver, pinfl: r.pinfl, addr: r.address, src: m?.addrSrc ?? '',
      reg: regionName(r.region) || `❌ ${r.region}`, area: areaName(r.area) || `❌ ${r.area}`,
      cnum: r.contract_number, cdate: r.contract_date, loan: r.loan_amount, debt: r.total_debt, overdue: r.overdue_debt ?? '', days: m?.days ?? '',
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.getColumn('pinfl').numFmt = '@'; ws.getColumn('loan').numFmt = '#,##0'; ws.getColumn('debt').numFmt = '#,##0'; ws.getColumn('overdue').numFmt = '#,##0';
  ws.getColumn('cdate').numFmt = 'dd.mm.yyyy';
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: 'N1' };
  const sw = wb.addWorksheet('Sonlar');
  sw.columns = [
    { header: 'Firma', key: 'firm', width: 14 }, { header: 'Roʻyxatda', key: 'listed', width: 11 },
    { header: 'Talabnoma', key: 'talabnoma', width: 11 }, { header: 'Shartnomalar', key: 'contracts', width: 13 },
    { header: 'Jami qarzdorlik', key: 'debtSum', width: 20 }, { header: 'Tuman taxminiy', key: 'fuzzyArea', width: 14 },
  ];
  for (const r of summary) sw.addRow(r);
  sw.getRow(1).font = { bold: true }; sw.getColumn('debtSum').numFmt = '#,##0';
  const fw = wb.addWorksheet('Muammolar');
  fw.columns = [{ header: 'Firma', key: 'firm', width: 14 }, { header: 'PINFL', key: 'pinfl', width: 16 }, { header: 'FISH', key: 'fio', width: 36 }, { header: 'Muammo', key: 'issue', width: 80 }];
  for (const f of flags) fw.addRow(f);
  fw.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(path.join(outDir, '_HAMMASI_korik.xlsx'));

  fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify({ summary, flags }, null, 1));
  console.table(summary);
  const issueCounts = flags.reduce<Record<string, number>>((m, f) => { const k = `${f.firm}: ${f.issue.replace(/[:(«].*$/, '').trim()}`; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log(issueCounts);
}

main().catch((e) => { console.error('✗', e); process.exit(1); });
