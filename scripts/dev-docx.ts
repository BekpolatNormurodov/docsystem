import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from '../src/lib/db';
import { getSettings } from '../src/lib/settings';
import { loanToAriza } from '../src/core/ariza';
import { buildArizaDocx } from '../src/lib/ariza-docx';

async function main() {
  const loan = await prisma.loan.findFirst({
    where: { branchCode: '12842', pinfl: { not: null } },
    orderBy: { totalDebt: 'desc' },
  });
  if (!loan) throw new Error('no loan found');
  const firm = await prisma.firm.findUnique({ where: { code: loan.branchCode! } });
  const snapshot = await prisma.snapshot.findUnique({ where: { id: loan.snapshotId } });
  const settings = await getSettings();
  const props = loanToAriza(loan as any, firm as any, settings, snapshot!.reportDate);
  const buf = await buildArizaDocx(props);
  const safe = `${loan.ldId} ${loan.clientName}`.replace(/[\/:*?"<>|]/g, '_');
  const out = `C:/Users/JONIBEK/AppData/Local/Temp/claude/C--Users-JONIBEK-Desktop-qrcode-pro/ddb9a92f-1dd1-45ab-a68a-517f23af0a78/scratchpad/${safe}.docx`;
  fs.writeFileSync(out, buf);
  console.log('WROTE:', out);
  console.log('bytes:', buf.length, '| loan', loan.ldId, '|', loan.clientName, '| total', String(loan.totalDebt), '| contractDate', loan.dateToCr?.toISOString().slice(0,10));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
