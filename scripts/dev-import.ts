import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { importPortfolio } from '../src/lib/import-portfolio';

// Dev-only: import a real portfolio xlsx into a dated snapshot (replace if present).
// Usage: npx tsx scripts/dev-import.ts "<path-to-xlsx>" [YYYY-MM-DD]
const FILE = process.argv[2];
const DATE = process.argv[3] || '2026-07-09';

async function main() {
  if (!FILE) throw new Error('pass the xlsx path as arg 1');
  const t0 = Date.now();
  const existing = await prisma.snapshot.findUnique({ where: { reportDate: new Date(DATE) } });
  if (existing?.status === 'IMPORTING') {
    throw new Error(`snapshot ${existing.id} for ${DATE} is currently IMPORTING — refusing to delete an in-flight import`);
  }
  if (existing) {
    await prisma.snapshot.delete({ where: { id: existing.id } });
    console.log('replaced existing snapshot', existing.id);
  }
  const snap = await prisma.snapshot.create({
    data: { reportDate: new Date(DATE), sourceFileName: FILE.split(/[\\/]/).pop()!, status: 'IMPORTING' },
  });
  console.log('snapshot', snap.id, '— importing', FILE);
  let last = 0;
  const res = await importPortfolio(FILE, snap.id, (n: number) => {
    if (n - last >= 10000) { last = n; console.log('  ...', n, 'rows,', Math.round((Date.now() - t0) / 1000) + 's'); }
  });
  await prisma.snapshot.update({
    where: { id: snap.id },
    data: { status: 'READY', rowCount: res.rows, totalDebt: res.totalDebt as any },
  });
  console.log('DONE:', res.rows, 'rows, totalDebt =', res.totalDebt, 'in', Math.round((Date.now() - t0) / 1000) + 's');
  await prisma.$disconnect();
}
main().catch((e) => { console.error('IMPORT FAILED:', e); process.exit(1); });
