// 29.09.2026 snapshot — 6-firma talabnoma partiyasiga mos (2026-09-29):
//   · портфель (25.09) oddiy import (importPortfolio) — sud ro'yxati = targets'dagi PINFL'lar;
//   · sud ro'yxati ANIQ (kishi × firma) juftliklariga qisqartiriladi (muddati o'tgan > 1 mln — 1 901 ta),
//     aks holda syncCasesFromSnapshot kishining BARCHA firmalariga ish ochardi;
//   · 25.09 portfelda post_address/viloyat/telefon yo'q → oldingi snapshot'lardan (avval shu firma,
//     keyin istalgan firma) to'ldiriladi — ariza manzili va sud/hippo viloyati shunga tayanadi;
//   · ishlar yaratiladi + talabnoma izi (TLB: → reyestr #254–#259) va talabnomaAt = yuborilgan vaqt.
// Import formasi bilan bir xil natija: portfel → uploads/<id>.xlsx, «Sud roʻyxati» (Pnfl) → uploads/<id>-exclude.xlsx
// (tizimning parseExclusionPinfls'i bilan o'qiladi), «Talabnoma roʻyxati» → umumiy app-doc (UI'da POST qulflangan).
//   npx tsx scripts/tlb-snapshot-import.ts <portfel.xlsx> <sud.xlsx> <talabnoma.xlsx> <targets.json>        → TEKSHIRUV
//   npx tsx scripts/tlb-snapshot-import.ts <portfel.xlsx> <sud.xlsx> <talabnoma.xlsx> <targets.json> --yes  → bajarish
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { importPortfolio } from '../src/lib/import-portfolio';
import { syncCasesFromSnapshot } from '../src/lib/konveyer';
import { recordSentTalabnomas } from '../src/lib/hippo/talabnoma-trace';
import { parseExclusionPinfls } from '../src/lib/parse-exclusion';
import { setAppDoc, APP_DOCS_DIR } from '../src/lib/app-docs';
import type { TalabnomaRow } from '../src/lib/hippo/talabnoma-excel';

interface Target { firm: { code: string; name: string }; registryId: number; sentAt: string; rows: TalabnomaRow[] }

const [portfolioPath, sudPath, talabnomaPath, targetsPath] = process.argv.slice(2);
const APPLY = process.argv.includes('--yes');
const REPORT_DATE = new Date('2026-09-29T00:00:00.000Z');

async function main() {
  if (!portfolioPath || !sudPath || !talabnomaPath || !targetsPath) throw new Error('usage: tlb-snapshot-import.ts <portfel.xlsx> <sud.xlsx> <talabnoma.xlsx> <targets.json> [--yes]');
  for (const f of [portfolioPath, sudPath, talabnomaPath, targetsPath]) if (!fs.existsSync(f)) throw new Error(`fayl topilmadi: ${f}`);
  const targets: Target[] = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const pairs = new Set<string>(); // `${pinfl}|${branchCode}`
  for (const t of targets) for (const r of t.rows) pairs.add(`${r.pinfl}|${t.firm.code}`);
  const pinfls = new Set([...pairs].map((p) => p.split('|')[0]!));
  console.log(`targets: ${targets.map((t) => `${t.firm.name} ${t.rows.length} (#${t.registryId})`).join(', ')} · juftlik ${pairs.size} · mijoz ${pinfls.size}`);
  // Sud ro'yxati — tizimning o'z o'quvchisi (import formasidagi kabi) bilan; targets bilan AYNAN bir xil bo'lishi shart.
  const sudPinfls = await parseExclusionPinfls(sudPath);
  const diff = [...pinfls].filter((p) => !sudPinfls.has(p)).length + [...sudPinfls].filter((p) => !pinfls.has(p)).length;
  console.log(`sud ro'yxati (Pnfl): ${sudPinfls.size} PINFL · targets bilan farq: ${diff}`);
  if (diff) throw new Error('sud ro\'yxati targets bilan mos emas');

  const firms = await prisma.firm.findMany({ select: { id: true, code: true, shortName: true, active: true } });
  for (const t of targets) {
    const f = firms.find((x) => x.code === t.firm.code);
    if (!f?.active) throw new Error(`firma ${t.firm.code} topilmadi yoki nofaol`);
  }
  const existing = await prisma.snapshot.findUnique({ where: { reportDate: REPORT_DATE } });
  if (existing) throw new Error(`29.09.2026 snapshot allaqachon bor (id ${existing.id}) — o'chirmaymiz, to'xtadik`);
  const prev = await prisma.snapshot.findMany({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' }, select: { id: true, reportDate: true } });
  console.log(`manzil manbasi: ${prev.map((p) => `#${p.id} ${p.reportDate.toISOString().slice(0, 10)}`).join(' → ')}`);
  if (!APPLY) { console.log('TEKSHIRUV — hech narsa yozilmadi. Bajarish: --yes'); return; }

  // 1) Snapshot + job (import route bilan bir xil), fayl uploads/ ga.
  const snapshot = await prisma.snapshot.create({ data: { reportDate: REPORT_DATE, sourceFileName: path.basename(portfolioPath), status: 'IMPORTING' } });
  const job = await prisma.job.create({ data: { type: 'IMPORT', status: 'RUNNING', snapshotId: snapshot.id, total: Math.round(fs.statSync(portfolioPath).size / 820) } });
  // Manba fayllar import route bilan bir xil joyga — sana kartasida «Portfel» / «Sud roʻyxati» yuklab olinadi.
  const uploads = path.join(process.cwd(), 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const portfelDst = path.join(uploads, `${snapshot.id}.xlsx`);
  fs.copyFileSync(portfolioPath, portfelDst);
  fs.copyFileSync(sudPath, path.join(uploads, `${snapshot.id}-exclude.xlsx`));
  console.log(`snapshot #${snapshot.id}, job #${job.id} — import boshlandi`);
  try {
    let last = 0;
    const res = await importPortfolio(portfelDst, snapshot.id, (n) => {
      if (n - last >= 20000) { last = n; console.log(`  … ${n} qator`); }
      prisma.job.updateMany({ where: { id: job.id }, data: { progress: n } }).catch(() => {});
    }, pinfls);
    console.log(`import: ${res.rows} qator, sud ro'yxatida (PINFL bo'yicha) ${res.excludedCount}`);

    // 2) Sud ro'yxatini aniq juftliklarga qisqartirish.
    const flagged = await prisma.loan.groupBy({ by: ['pinfl', 'branchCode'], where: { snapshotId: snapshot.id, excluded: true } });
    let unflagged = 0;
    for (const g of flagged) {
      if (pairs.has(`${g.pinfl}|${g.branchCode}`)) continue;
      const u = await prisma.loan.updateMany({ where: { snapshotId: snapshot.id, pinfl: g.pinfl, branchCode: g.branchCode }, data: { excluded: false } });
      unflagged += u.count;
    }
    const excludedCount = await prisma.loan.count({ where: { snapshotId: snapshot.id, excluded: true } });
    console.log(`sud ro'yxati: ${unflagged} kredit olib tashlandi → qoldi ${excludedCount} kredit`);

    // 3) Manzil / viloyat / telefon — oldingi snapshot'lardan (avval shu firma, keyin istalgan firma).
    //    postAddressUz importda faqat tumandan yasalgan («X tumani») → to'liq manzil bilan ALMASHTIRILADI.
    for (const p of prev) {
      for (const sameFirm of [true, false]) {
        const n = await prisma.$executeRawUnsafe(`
          UPDATE Loan n JOIN (
            SELECT pinfl, ${sameFirm ? 'branchCode,' : ''} MAX(postAddress) pa, MAX(postAddressUz) pu, MAX(regionName) rn, MAX(phone) ph
            FROM Loan WHERE snapshotId = ? AND pinfl IS NOT NULL AND postAddress IS NOT NULL
            GROUP BY pinfl${sameFirm ? ', branchCode' : ''}
          ) s ON s.pinfl = n.pinfl ${sameFirm ? 'AND s.branchCode = n.branchCode' : ''}
          SET n.postAddress = s.pa, n.postAddressUz = COALESCE(s.pu, n.postAddressUz), n.regionName = COALESCE(n.regionName, s.rn), n.phone = COALESCE(n.phone, s.ph)
          WHERE n.snapshotId = ? AND n.postAddress IS NULL`, p.id, snapshot.id);
        console.log(`  manzil ← #${p.id} ${sameFirm ? 'shu firma' : 'istalgan firma'}: ${n} kredit`);
      }
    }
    const noAddr = await prisma.loan.count({ where: { snapshotId: snapshot.id, postAddress: null } });
    const noAddrCourt = await prisma.loan.count({ where: { snapshotId: snapshot.id, postAddress: null, excluded: true } });
    console.log(`manzilsiz qoldi: ${noAddr} kredit (sud ro'yxatida: ${noAddrCourt})`);

    // 4) READY + ishlar.
    const debt = await prisma.loan.aggregate({ where: { snapshotId: snapshot.id }, _sum: { totalDebt: true } });
    await prisma.snapshot.update({ where: { id: snapshot.id }, data: { status: 'READY', rowCount: res.rows, processedRows: res.rows, totalDebt: debt._sum.totalDebt ?? 0, excludedCount } });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'DONE', progress: res.rows, total: res.rows } });
    const synced = await syncCasesFromSnapshot(snapshot.id);
    console.log(`ishlar: +${synced.created} (skip ${synced.skipped}, nofaol firma kodlari: ${synced.unmatchedFirms.join(',') || '—'})`);

    // 5) Talabnoma izi + talabnomaAt (reyestr yaratilgan vaqt).
    for (const t of targets) {
      const firm = firms.find((x) => x.code === t.firm.code)!;
      const traced = await recordSentTalabnomas(t.rows, { snapshotId: snapshot.id, branchCode: t.firm.code, registryId: String(t.registryId), status: 'SENT' });
      const marked = await prisma.arizaCase.updateMany({
        where: { snapshotId: snapshot.id, firmId: firm.id, pinfl: { in: t.rows.map((r) => String(r.pinfl)) }, talabnomaAt: null },
        data: { talabnomaAt: new Date(t.sentAt) },
      });
      console.log(`  ${t.firm.name}: iz ${traced}, talabnomaAt ${marked.count} (reyestr #${t.registryId})`);
    }
    // «Talabnoma roʻyxati» — umumiy app-doc (Setting + exports/app-docs), UI POST qulflangan.
    fs.mkdirSync(APP_DOCS_DIR, { recursive: true });
    const talDst = path.join(APP_DOCS_DIR, 'talabnoma-2026-09-29.xlsx');
    fs.copyFileSync(talabnomaPath, talDst);
    await setAppDoc('talabnoma', { label: path.basename(talabnomaPath), filePath: talDst, uploadedAt: new Date().toISOString(), size: fs.statSync(talDst).size });
    console.log(`talabnoma roʻyxati: ${talDst}`);
    const cases = await prisma.arizaCase.groupBy({ by: ['firmId'], where: { snapshotId: snapshot.id }, _count: { _all: true } });
    console.log('YAKUN — ishlar firma bo\'yicha:', cases.map((c) => `${firms.find((f) => f.id === c.firmId)?.shortName}: ${c._count._all}`).join(' · '));
  } catch (e) {
    await prisma.job.updateMany({ where: { id: job.id }, data: { status: 'FAILED', message: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    await prisma.snapshot.updateMany({ where: { id: snapshot.id }, data: { status: 'FAILED' } }).catch(() => {});
    throw e;
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error('✗', e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1); });
