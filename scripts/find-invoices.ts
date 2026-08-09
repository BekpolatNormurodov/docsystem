import { prisma } from '../src/lib/db';

async function main() {
  // InvoiceRecord (billing invoices) + firm
  const firms = await prisma.firm.findMany({ select: { id: true, code: true, shortName: true } });
  const fById = new Map(firms.map((f) => [f.id, f]));
  const inv: any[] = await prisma.$queryRawUnsafe('SELECT firmId, COUNT(*) c FROM invoicerecord GROUP BY firmId');
  console.log('InvoiceRecord by firm:');
  inv.forEach((r) => console.log(`  firmId=${r.firmId} (${fById.get(r.firmId)?.code ?? '?'} ${fById.get(r.firmId)?.shortName ?? ''}) -> ${Number(r.c)}`));

  // invoicebatch table
  try {
    const b: any[] = await prisma.$queryRawUnsafe('SELECT COUNT(*) c FROM invoicebatch');
    console.log('\ninvoicebatch rows:', Number(b[0].c));
    const cols: any[] = await prisma.$queryRawUnsafe('SHOW COLUMNS FROM invoicebatch');
    console.log('  columns:', cols.map((c) => c.Field).join(', '));
  } catch (e: any) { console.log('invoicebatch:', e.message); }

  // any arizacase with invoice, by firm
  const az: any[] = await prisma.$queryRawUnsafe("SELECT kod, SUM(invoiceNo IS NOT NULL OR receiptNumber IS NOT NULL) withInv, COUNT(*) total FROM arizacase GROUP BY kod");
  console.log('\narizacase invoice linkage:');
  az.forEach((r) => console.log(`  ${r.kod}: ${Number(r.withInv)}/${Number(r.total)}`));

  // sample InvoiceRecord rows
  const sample: any[] = await prisma.$queryRawUnsafe('SELECT invoiceNo, firmId, amount, paymentType, status FROM invoicerecord LIMIT 8');
  console.log('\nInvoiceRecord sample:');
  sample.forEach((r) => console.log(`  ${r.invoiceNo}  firm=${r.firmId}  ${r.amount}  ${r.paymentType}  ${r.status}`));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
