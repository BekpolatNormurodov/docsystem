// Check every stored billing.sud.uz invoice (InvoiceRecord) + download its PDF.
// Public, no auth. -> exports/billing-invoices/{number}.pdf
//   npx tsx scripts/billing-sync-all.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkInvoiceStatus, downloadInvoice, mapStatus } from '../src/lib/billing/invoice';
import { prisma } from '../src/lib/db';

async function main() {
  const invoices = await prisma.invoiceRecord.findMany({ select: { invoiceNo: true, amount: true } });
  const dir = path.join(process.cwd(), 'exports', 'billing-invoices');
  await fs.mkdir(dir, { recursive: true });
  console.log(`billing invoices: ${invoices.length}\n`);
  let paid = 0, ok = 0;
  for (const inv of invoices) {
    try {
      const b = await checkInvoiceStatus(inv.invoiceNo);
      const st = mapStatus(b.invoiceStatus);
      if (st === 'PAID') paid++;
      let pdf = '-';
      try { const buf = await downloadInvoice(inv.invoiceNo); const f = path.join(dir, `${inv.invoiceNo}.pdf`); await fs.writeFile(f, buf); pdf = `${(buf.length / 1024).toFixed(0)}KB`; ok++; } catch {}
      console.log(`${inv.invoiceNo}  ${b.invoiceStatus} (${st})  mustPay=${b.mustPayAmount} paid=${b.paidAmount}  ${b.payCategory ?? ''}  pdf=${pdf}`);
    } catch (e: any) { console.log(`${inv.invoiceNo}  ERR ${e.message}`); }
  }
  console.log(`\n✅ ${ok} PDFs -> ${dir} | paid ${paid}/${invoices.length}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
