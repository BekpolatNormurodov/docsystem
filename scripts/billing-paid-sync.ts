// Check each pipeline invoice (arizacase.receiptNumber) against billing.sud.uz and
// reflect payment: PAID -> advance stage to INVOICE_PAID; store invoiceStatus +
// paidAmount in arizacase.meta either way so "to'landimi" is visible. Public, no
// auth. Advance-only.
//   npx tsx scripts/billing-paid-sync.ts
import { checkInvoiceStatus, mapStatus } from '../src/lib/billing/invoice';
import { prisma } from '../src/lib/db';

const STAGES = ['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED'];
const idx = (s: string) => STAGES.indexOf(s);

async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(
    "SELECT id, kod, pinfl, stage, receiptNumber FROM arizacase WHERE receiptNumber IS NOT NULL",
  );
  console.log(`invoices to check: ${rows.length}\n`);
  let paid = 0, unpaid = 0, advanced = 0, err = 0;
  for (const r of rows) {
    try {
      const b = await checkInvoiceStatus(r.receiptNumber);
      const st = mapStatus(b.invoiceStatus);
      const isPaid = st === 'PAID';
      if (isPaid) paid++; else unpaid++;
      // advance to INVOICE_PAID only when paid and not already past it
      const target = isPaid && idx(r.stage) < idx('INVOICE_PAID') ? 'INVOICE_PAID' : r.stage;
      await prisma.$executeRawUnsafe(
        `UPDATE arizacase SET stage=?, stageEnteredAt=IF(stage<>?, NOW(3), stageEnteredAt),
           meta=JSON_MERGE_PATCH(COALESCE(meta,'{}'), CAST(? AS JSON)) WHERE id=?`,
        target, target,
        JSON.stringify({ invoiceStatus: b.invoiceStatus, invoicePaid: isPaid, paidAmount: b.paidAmount, mustPay: b.mustPayAmount, invoiceCheckedAt: new Date().toISOString() }),
        r.id,
      );
      if (target !== r.stage) advanced++;
      console.log(`  ${r.kod} ${r.receiptNumber}: ${b.invoiceStatus} (${st})  paid=${b.paidAmount}/${b.mustPayAmount}${target !== r.stage ? '  -> INVOICE_PAID' : ''}`);
    } catch (e: any) { err++; console.log(`  ${r.receiptNumber}: ERR ${e.message}`); }
  }
  console.log(`\npaid ${paid}, unpaid ${unpaid}, advanced to INVOICE_PAID ${advanced}, errors ${err}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
