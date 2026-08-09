// Generate xat.hippo-ready talabnoma Excel (and optionally PDFs) for a firm's
// court-list clients.
//   npx tsx scripts/hippo-talabnoma-export.ts [firm|all] [limit] [--pdf]
// Examples:
//   ... 12842 300            -> BRIGHT, first 300 clients, Excel only
//   ... all                  -> every firm with court clients, Excel each
//   ... 12842 50 --pdf       -> BRIGHT, 50 clients, Excel + PDFs
// Defaults: firm 12842 (BRIGHT), no limit.
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { buildTalabnomaRows, writeTalabnomaExcel, type TalabnomaLoan } from '../src/lib/hippo/talabnoma-excel';
import { renderTalabnomaPdfs } from '../src/lib/hippo/talabnoma-pdf';

const OUT = path.join(process.cwd(), 'exports');

async function exportFirm(snapshotId: number, reportDate: Date, branchCode: string, shortName: string, limit: number | null, pdf: boolean) {
  const docDate = new Date();
  const loans = (await prisma.loan.findMany({
    where: { snapshotId, excluded: true, branchCode },
    orderBy: [{ pinfl: 'asc' }, { branchCode: 'asc' }, { id: 'asc' }],
    select: { pinfl: true, branchCode: true, clientName: true, postAddress: true, regionName: true, ldId: true, dateToCr: true, summKr: true, totalDebt: true, raw: true },
  })) as TalabnomaLoan[];

  let rows = buildTalabnomaRows(loans, docDate);
  if (limit && rows.length > limit) rows = rows.slice(0, limit);

  const tag = `${shortName.replace(/\W+/g, '_')}_${reportDate.toISOString().slice(0, 10)}${limit ? `_first${limit}` : ''}`;
  const xlsx = path.join(OUT, `talabnoma_${tag}.xlsx`);
  await fs.mkdir(OUT, { recursive: true });
  await writeTalabnomaExcel(rows, xlsx);

  const missReg = rows.filter((r) => !r.region).length;
  const missArea = rows.filter((r) => !r.area).length;
  console.log(`[${branchCode}] ${shortName}: ${loans.length} loans -> ${rows.length} rows | region miss ${missReg}, area miss ${missArea}`);
  console.log(`   excel: ${xlsx}`);

  if (pdf) {
    const dir = path.join(OUT, `talabnoma_pdf_${tag}`);
    const files = await renderTalabnomaPdfs(rows, dir);
    console.log(`   pdfs : ${files.length} -> ${dir}`);
  }
}

async function main() {
  const firmArg = process.argv[2] || '12842';
  const limit = process.argv[3] && /^\d+$/.test(process.argv[3]) ? Number(process.argv[3]) : null;
  const pdf = process.argv.includes('--pdf');

  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  if (!snap) throw new Error('No snapshot');
  const firms = await prisma.firm.findMany();
  const nameOf = (code: string) => firms.find((f) => f.code === code)?.shortName ?? code;

  let branchCodes: string[];
  if (firmArg === 'all') {
    const g = await prisma.loan.groupBy({ by: ['branchCode'], where: { snapshotId: snap.id, excluded: true } });
    branchCodes = g.map((x) => x.branchCode).filter((c): c is string => !!c);
  } else {
    branchCodes = [firmArg];
  }
  console.log(`snapshot ${snap.reportDate.toISOString().slice(0, 10)} | firms: ${branchCodes.join(', ')}${limit ? ` | limit ${limit}` : ''}${pdf ? ' | +PDF' : ''}\n`);
  for (const code of branchCodes) await exportFirm(snap.id, snap.reportDate, code, nameOf(code), limit, pdf);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
