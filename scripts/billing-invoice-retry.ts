// Auto-retry BRIGHT billing-invoice sync: probe billing.sud.uz (short timeout);
// if up, for every BRIGHT InvoiceRecord check payment status + download the PDF and
// persist to CourtFeeInvoice (status/amounts/docPath). Designed to be run
// repeatedly by the OS scheduler until billing recovers. Logs to
// exports/billing-retry.log. Public API, no auth.
//   npx tsx scripts/billing-invoice-retry.ts
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { mapStatus } from '../src/lib/billing/invoice';

const BILLING = 'https://billing.sud.uz';
const ACCOUNT = '311976765';

async function billingGet(url: string, timeoutMs = 12000): Promise<Response> {
  return fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
}

async function main() {
  const logFile = path.join(process.cwd(), 'exports', 'billing-retry.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (m: string) => { const line = `${new Date().toISOString()}  ${m}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };

  const invoices = await prisma.invoiceRecord.findMany({ where: { firm: { code: '12842' } }, select: { invoiceNo: true } });
  if (!invoices.length) { log('no BRIGHT invoices'); return; }

  // probe: is billing up?
  try {
    const p = await billingGet(`${BILLING}/api/invoice/checkStatus?invoice=${invoices[0].invoiceNo}&lang=ru`, 10000);
    if (!p.ok && p.status >= 500) throw new Error('server ' + p.status);
  } catch (e: any) { log(`billing DOWN (${e.message}) — will retry later`); return; }

  const dir = path.join(process.cwd(), 'exports', 'billing-invoices');
  fs.mkdirSync(dir, { recursive: true });
  let paid = 0, unpaid = 0, pdfs = 0, err = 0;

  for (const { invoiceNo } of invoices) {
    try {
      const res = await billingGet(`${BILLING}/api/invoice/checkStatus?invoice=${invoiceNo}&lang=ru`);
      const b: any = await res.json();
      const status = mapStatus(b.invoiceStatus);
      if (status === 'PAID') paid++; else unpaid++;

      // download PDF
      let docPath: string | null = null;
      try {
        const pdf = await billingGet(`${BILLING}/api/invoice/asDocument?invoice=${invoiceNo}`, 20000);
        const buf = Buffer.from(await pdf.arrayBuffer());
        if (buf.slice(0, 4).toString() === '%PDF') { docPath = path.join(dir, `${invoiceNo}.pdf`); fs.writeFileSync(docPath, buf); pdfs++; }
      } catch { /* pdf optional */ }

      // persist to CourtFeeInvoice
      await prisma.courtFeeInvoice.upsert({
        where: { account_receiptNumber: { account: ACCOUNT, receiptNumber: invoiceNo } },
        create: { account: ACCOUNT, receiptNumber: invoiceNo, status, amountTotal: b.mustPayAmount ?? null, paidAt: status === 'PAID' ? new Date() : null, meta: { billing: b, docPath } as any },
        update: { status, amountTotal: b.mustPayAmount ?? null, paidAt: status === 'PAID' ? new Date() : null, meta: { billing: b, docPath } as any },
      });
      log(`${invoiceNo}: ${b.invoiceStatus} (${status}) paid=${b.paidAmount}/${b.mustPayAmount} pdf=${docPath ? 'yes' : 'no'}`);
    } catch (e: any) { err++; log(`${invoiceNo}: ERR ${e.message}`); }
  }
  log(`DONE: paid ${paid}, unpaid ${unpaid}, pdfs ${pdfs}, errors ${err}`);
  await prisma.$disconnect();
}
main().catch((e) => { try { fs.appendFileSync(path.join(process.cwd(), 'exports', 'billing-retry.log'), `${new Date().toISOString()}  FATAL ${e.message}\n`); } catch {} process.exit(1); });
