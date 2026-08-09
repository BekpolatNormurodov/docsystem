// Demo the DB-backed davlat-boji lifecycle: compute fee -> store NOT_PAID ->
// attach receipt & mark IN_PROCESS -> (sync payment). Stored session, no signing.
//   npx tsx scripts/cabinet-fee.ts [amount=10000000] [receipt=262196086404]
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { computeAndRecordFee, markInvoiceInProcess, listInvoices, STATUS_LABEL } from '../src/lib/cabinet/invoice';
import { prisma } from '../src/lib/db';

async function main() {
  const account = '311976765';
  const amount = Number(process.argv[2] ?? 10000000);
  const receipt = process.argv[3] ?? '262196086404';
  const s = await getStoredCabinetSession(account);

  const { fees, total, invoice } = await computeAndRecordFee(s, account, {
    instance: 'FIRST', claimType: 'CIVIL', claimKind: 'SUIT', amount,
  });
  console.log(`fee for ${amount.toLocaleString()} so'm ->`, fees, `total=${total}`);
  console.log(`stored invoice #${invoice.id} status=${invoice.status} (${STATUS_LABEL[invoice.status]})`);

  const inProc = await markInvoiceInProcess(invoice.id, receipt);
  console.log(`receipt ${receipt} attached -> status=${inProc.status} (${STATUS_LABEL[inProc.status]})`);

  console.log('\ninvoices for', account, ':');
  for (const i of await listInvoices(account))
    console.log(`  #${i.id}  ${String(i.claimAmount)} so'm  total=${i.amountTotal}  ${i.status} (${STATUS_LABEL[i.status]})  receipt=${i.receiptNumber ?? '-'}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
