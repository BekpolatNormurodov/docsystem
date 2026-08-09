// Check a billing.sud.uz invoice + download its PDF, and sync any matching
// CourtFeeInvoice. Public — no auth/session.
//   npx tsx scripts/billing-invoice.ts <invoiceNumber>
import { checkInvoiceStatus, downloadInvoice, mapStatus, syncBillingInvoice } from '../src/lib/billing/invoice';
import { prisma } from '../src/lib/db';

async function main() {
  const number = process.argv[2] ?? '262196086404';
  const b = await checkInvoiceStatus(number);
  console.log(`invoice ${number}: ${b.invoiceStatus} -> ${mapStatus(b.invoiceStatus)}`);
  console.log(`  mustPay=${b.mustPayAmount}  paid=${b.paidAmount}  category=${b.payCategory}  court=${b.court}  payer=${b.payer}`);

  const cfi = await prisma.courtFeeInvoice.findFirst({ where: { receiptNumber: number } });
  if (cfi) {
    const r = await syncBillingInvoice(cfi.id);
    console.log(`\nCourtFeeInvoice #${cfi.id} synced -> status=${r.status}  pdf=${r.docPath ?? '-'}`);
  } else {
    const buf = await downloadInvoice(number);
    console.log(`\nno CourtFeeInvoice row; downloaded PDF (${buf.length} bytes) — pass a tracked receipt to store it`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
