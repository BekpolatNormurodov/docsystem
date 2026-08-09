// One-off audit: generate every document type for a real case in each of a few
// firms, dump the key extracted values, and write the files for inspection.
//   npx tsx scripts/audit-docs.ts
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { buildArizaDocx } from '@/lib/ariza-docx';
import { loansToAriza, type ArizaFirm } from '@/core/ariza';
import { buildTalabnomaRows, talabnomaExcelBuffer, type TalabnomaLoan } from '@/lib/hippo/talabnoma-excel';
import { renderTalabnomaPdf } from '@/lib/hippo/talabnoma-pdf';
import { buildInvoiceDocx } from '@/lib/invoice-docx';

const OUT = process.env.AUDIT_OUT || path.join(process.cwd(), 'storage', 'audit');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const snap = await prisma.snapshot.findFirst({ orderBy: { id: 'desc' } });
  if (!snap) { console.log('no snapshot'); return; }
  console.log(`snapshot #${snap.id} reportDate=${snap.reportDate?.toISOString?.().slice(0, 10)}`);

  // distinct firms that have cases in this snapshot
  const firms = await prisma.arizaCase.groupBy({ by: ['firmId', 'kod'], where: { snapshotId: snap.id }, _count: { _all: true } });
  const pickedFirms = new Map<number, string | null>();
  for (const f of firms) if (!pickedFirms.has(f.firmId)) pickedFirms.set(f.firmId, f.kod);
  const firmIds = [...pickedFirms.keys()].slice(0, 4);

  const settings = await getSettings();
  const reportDate = snap.reportDate ?? new Date();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    for (const firmId of firmIds) {
      const firm = await prisma.firm.findUnique({ where: { id: firmId } });
      // a case in this firm that actually has portfolio loans
      const cases = await prisma.arizaCase.findMany({ where: { firmId, snapshotId: snap.id, pinfl: { not: null } }, take: 8, select: { id: true, pinfl: true, kod: true, clientName: true } });
      let chosen: { id: number; pinfl: string | null; kod: string | null; clientName: string | null } | null = null;
      let loans: any[] = [];
      for (const c of cases) {
        const ls = await prisma.loan.findMany({ where: { snapshotId: snap.id, pinfl: c.pinfl!, ...(c.kod ? { branchCode: c.kod } : {}) }, orderBy: { id: 'asc' } });
        if (ls.length) { chosen = c; loans = ls; break; }
      }
      if (!chosen) { console.log(`\n### firm ${firm?.shortName} (#${firmId}) — no case with loans`); continue; }

      console.log(`\n### ${firm?.shortName} (#${firmId}) — case #${chosen.id} ${chosen.clientName} | loans=${loans.length}`);
      const safe = (chosen.clientName || `case-${chosen.id}`).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
      const dir = path.join(OUT, `${firm?.shortName || firmId}__${safe}`);
      fs.mkdirSync(dir, { recursive: true });

      // 1) Talabnoma rows / excel / pdf
      const rows = buildTalabnomaRows(loans as unknown as TalabnomaLoan[], reportDate);
      console.log(`  talabnoma rows=${rows.length}`);
      for (const r of rows) {
        console.log(`    contract_id=${r.contract_id} region=${r.region} area=${r.area} loan=${r.loan_amount} debt=${r.total_debt}`);
        console.log(`      receiver="${r.receiver}"`);
        console.log(`      address="${r.address}"`);
        console.log(`      contract_number="${r.contract_number}" contract_date=${r.contract_date?.toISOString?.().slice(0, 10) ?? 'NULL'}`);
        console.log(`      debt_words="${r.total_debt_words}"`);
        if (r.region === 0 || r.area === 0) console.log(`      !! REGION/AREA UNRESOLVED (region=${r.region} area=${r.area}) regionName="${(loans[0] as any).regionName}" distr="${(loans[0] as any).raw?.distr_name}"`);
      }
      if (rows.length) {
        fs.writeFileSync(path.join(dir, 'talabnoma.xlsx'), await talabnomaExcelBuffer(rows));
        try {
          fs.writeFileSync(path.join(dir, 'talabnoma.pdf'), await renderTalabnomaPdf(rows[0], browser, firm));
          console.log('  talabnoma.pdf OK');
        } catch (e) { console.log('  !! talabnoma.pdf FAILED', (e as Error).message); }
      }

      // 2) Ariza docx
      try {
        const arizaFirm: ArizaFirm = { shortName: firm?.shortName || chosen.kod || 'X', legalName: firm?.legalName ?? null, address: firm?.address ?? null, bankAccount: firm?.bankAccount ?? null, mfo: firm?.mfo ?? null, stir: firm?.stir ?? null };
        const props = loansToAriza(loans as any, arizaFirm, settings, reportDate);
        fs.writeFileSync(path.join(dir, 'ariza.docx'), Buffer.from(await buildArizaDocx(props)));
        const badDate = props.contracts.some((c) => !c.date || isNaN(+new Date(c.date as any)));
        console.log(`  ariza.docx OK  addr="${props.personAddress}" rate=${props.interestRate} loanAmount=${props.loanAmount} total=${props.debtTotal} contracts=${props.contracts.length}${badDate ? '  !! NULL/INVALID contract date' : ''}`);
      } catch (e) { console.log('  !! ariza.docx FAILED', (e as Error).message); }

      // 3) Invoice docx (simulate an assigned receipt)
      try {
        fs.writeFileSync(path.join(dir, 'invoice.docx'), await buildInvoiceDocx({ clientName: chosen.clientName, kod: chosen.kod, receiptNumber: '262000123456', firm }));
        console.log('  invoice.docx OK');
      } catch (e) { console.log('  !! invoice.docx FAILED', (e as Error).message); }
    }
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
  console.log(`\nfiles → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
