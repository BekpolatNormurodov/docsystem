// Ariza tayyorlashdan OLDIN quruq tekshiruv (faqat o'qiydi — hech narsa yaratmaydi/yozmaydi):
// snapshot'ning har bir ishi uchun «Arizani tayyorlash» (buildCasePacket arizaOnly) bilan AYNAN bir xil
// ma'lumot yig'iladi — kreditlar (snapshot × PINFL × firma) + withActualClose + firma + sozlamalar + sud —
// loansToAriza chaqiriladi va maydonlar tekshiriladi; talabnoma (hippo'ga ketgan) bilan summa/shartnomalar solishtiriladi.
//   npx tsx scripts/tlb-ariza-check.ts <snapshotId> <targets.json> <out.xlsx>
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { prisma } from '../src/lib/db';
import { withActualClose } from '../src/lib/loan-actual-close';
import { getSettings } from '../src/lib/settings';
import { firmPrimaryCourt } from '../src/lib/court-routing';
import { loansToAriza, type ArizaFirm } from '../src/core/ariza';

const [snapArg, targetsPath, outPath] = process.argv.slice(2);
const code = (c: string | null | undefined) => String(c ?? '').trim().replace(/^0+/, '');

async function main() {
  const snapshotId = Number(snapArg);
  if (!snapshotId || !targetsPath || !outPath) throw new Error('usage: tlb-ariza-check.ts <snapshotId> <targets.json> <out.xlsx>');
  // Talabnoma (hippo) — firma kodi × PINFL → total_debt + shartnomalar.
  const targets: { firm: { code: string; name: string }; rows: { pinfl: string; total_debt: number; contract_number: string }[] }[] = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const tal = new Map<string, { debt: number; contracts: string }>();
  for (const t of targets) for (const r of t.rows) tal.set(`${code(t.firm.code)}|${r.pinfl}`, { debt: r.total_debt, contracts: r.contract_number });

  const settings = await getSettings();
  const cases = await prisma.arizaCase.findMany({
    where: { snapshotId },
    select: { id: true, pinfl: true, kod: true, clientName: true, firmId: true, court: { select: { nameUz: true } } },
    orderBy: { id: 'asc' },
  });
  const firms = await prisma.firm.findMany();
  const firmByCode = new Map(firms.map((f) => [code(f.code), f]));
  const courtByFirm = new Map<number, string | null>();

  const issues: { firm: string; caseId: number; pinfl: string; fio: string; issue: string; detail: string }[] = [];
  const counts = new Map<string, Map<string, number>>(); // issue → firm → n
  const perFirm = new Map<string, { cases: number; ok: number; debt: number }>();
  const add = (firm: string, c: { id: number; pinfl: string | null; clientName: string | null }, issue: string, detail = '') => {
    issues.push({ firm, caseId: c.id, pinfl: c.pinfl ?? '', fio: c.clientName ?? '', issue, detail });
    const m = counts.get(issue) ?? new Map<string, number>(); m.set(firm, (m.get(firm) ?? 0) + 1); counts.set(issue, m);
  };

  let done = 0;
  for (const c of cases) {
    const firm = firmByCode.get(code(c.kod));
    const fname = firm?.shortName ?? c.kod ?? '?';
    const pf = perFirm.get(fname) ?? { cases: 0, ok: 0, debt: 0 }; pf.cases++; perFirm.set(fname, pf);
    const before = issues.length;
    if (!c.pinfl) { add(fname, c, 'PINFL yoʻq'); continue; }
    const loans = await withActualClose(await prisma.loan.findMany({ where: { snapshotId, pinfl: c.pinfl, ...(c.kod ? { branchCode: c.kod } : {}) }, orderBy: { id: 'asc' } }));
    if (!loans.length) { add(fname, c, 'Kredit topilmadi'); continue; }
    if (!courtByFirm.has(c.firmId)) courtByFirm.set(c.firmId, (await firmPrimaryCourt(c.firmId).catch(() => null))?.nameUz ?? null);
    const courtName = c.court?.nameUz ?? courtByFirm.get(c.firmId) ?? null;
    const arizaFirm: ArizaFirm = { shortName: firm?.shortName || c.kod || 'Unknown', legalName: firm?.legalName ?? null, address: firm?.address ?? null, bankAccount: firm?.bankAccount ?? null, mfo: firm?.mfo ?? null, stir: firm?.stir ?? null };
    const p = loansToAriza(loans, arizaFirm, settings, new Date(), courtName ?? undefined);

    const debt = Number(p.debtTotal);
    if (!(debt > 0)) add(fname, c, 'Qarz 0 — ariza YASALMAYDI', String(p.debtTotal));
    if (!courtName) add(fname, c, 'Sud aniqlanmadi (sozlamadagi umumiy nom ketadi)', String(p.courtName ?? ''));
    const addr = String(p.personAddress ?? '').trim();
    if (!addr) add(fname, c, 'Manzil yoʻq');
    else {
      if (!/\d/.test(addr) && addr.split(',').length <= 1) add(fname, c, 'Manzil faqat tuman/shahar', addr);
      if (!/viloyati|respublikasi|toshkent shahri/i.test(addr)) add(fname, c, 'Manzilda viloyat yoʻq', addr);
    }
    const addrs = new Set(loans.map((l) => (l.postAddressUz || l.postAddress || '').trim()));
    if (addrs.size > 1) add(fname, c, 'Kreditlarda turli manzil (1-si olinadi)', [...addrs].join(' | ').slice(0, 200));
    if (!p.personPhone) add(fname, c, 'Telefon yoʻq');
    if (!p.personFullName) add(fname, c, 'F.I.Sh yoʻq');
    const badContracts = p.contracts.filter((k) => !k.number || !k.date);
    if (badContracts.length) add(fname, c, 'Shartnoma raqami/sanasi yoʻq', `${badContracts.length}/${p.contracts.length}`);
    if (!p.interestRate) add(fname, c, 'Foiz stavkasi yoʻq');
    if (!(Number(p.loanAmount) > 0)) add(fname, c, 'Kredit summasi 0');
    for (const [k, v] of [['legalName', firm?.legalName], ['address', firm?.address], ['bankAccount', firm?.bankAccount], ['mfo', firm?.mfo], ['stir', firm?.stir]] as const) {
      if (!v) add(fname, c, `Firma rekviziti yoʻq: ${k}`);
    }
    const t = tal.get(`${code(c.kod)}|${c.pinfl}`);
    if (!t) add(fname, c, 'Talabnoma roʻyxatida yoʻq');
    else {
      if (Math.abs(Math.round(debt) - t.debt) > 1) add(fname, c, 'Summa talabnomadan farq qiladi', `ariza ${Math.round(debt)} / talabnoma ${t.debt}`);
      const a = [...new Set(p.contracts.map((k) => k.number))].sort().join('-');
      const b = [...new Set(t.contracts.split('-'))].sort().join('-');
      if (a !== b) add(fname, c, 'Shartnomalar talabnomadan farq qiladi', `ariza ${a} / talabnoma ${b}`);
    }
    if (issues.length === before) pf.ok++;
    pf.debt += debt;
    if (++done % 300 === 0) console.log(`  … ${done}/${cases.length}`);
  }

  console.log(`ishlar: ${cases.length} · sozlama: contractType=«${settings.contractType}» signer=«${settings.signerName}» executor=«${settings.executorName}»`);
  console.log('FIRMALAR:', [...perFirm].map(([f, v]) => `${f}: ${v.cases} ish, muammosiz ${v.ok}, jami qarz ${Math.round(v.debt).toLocaleString('ru-RU')}`).join(' · '));
  console.log('MUAMMOLAR:');
  for (const [issue, m] of [...counts].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
    console.log(`  ${[...m.values()].reduce((x, y) => x + y, 0)} × ${issue} — ${[...m].map(([f, n]) => `${f} ${n}`).join(', ')}`);
  }
  console.log('sudlar:', [...new Set([...courtByFirm.values()])].join(' | '));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Muammolar');
  ws.columns = [{ header: 'Firma', key: 'firm', width: 24 }, { header: 'Ish ID', key: 'caseId', width: 9 }, { header: 'PINFL', key: 'pinfl', width: 16 }, { header: 'F.I.Sh', key: 'fio', width: 36 }, { header: 'Muammo', key: 'issue', width: 40 }, { header: 'Tafsilot', key: 'detail', width: 80 }];
  for (const i of issues) ws.addRow(i);
  ws.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(outPath);
  console.log(`Excel: ${outPath} (${issues.length} qator)`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error('✗', e); await prisma.$disconnect(); process.exit(1); });
