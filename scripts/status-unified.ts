// Unified per-client match: for each court-list client (excluded) join their
// cabinet ariza status + hippo talabnoma delivery status (both matched by pinfl),
// and flag whether we also hold a billing invoice. Prints coverage + writes a
// per-client CSV. Read-only.
//   npx tsx scripts/status-unified.ts [branchCode|all]
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { FIRMS } from '../src/lib/firms';

async function forFirm(branchCode: string, snapshotId: number) {
  // court-list clients (unique pinfl)
  const loans = await prisma.loan.findMany({
    where: { snapshotId, excluded: true, branchCode }, select: { pinfl: true, clientName: true },
  });
  const clients = new Map<string, string>();
  for (const l of loans) if (l.pinfl) clients.set(l.pinfl, l.clientName || '');

  // cabinet + hippo statuses for this firm, indexed by pinfl (latest row wins)
  const cab = await prisma.clientCaseStatus.findMany({ where: { source: 'CABINET', branchCode, pinfl: { not: null } }, select: { pinfl: true, status: true, caseNumber: true } });
  const hip = await prisma.clientCaseStatus.findMany({ where: { source: 'HIPPO', branchCode, pinfl: { not: null } }, select: { pinfl: true, status: true } });
  const cabBy = new Map<string, any>(); for (const c of cab) cabBy.set(c.pinfl!, c);
  const hipBy = new Map<string, any>(); for (const h of hip) if (!hipBy.has(h.pinfl!)) hipBy.set(h.pinfl!, h);

  const rows: string[] = ['pinfl,client,cabinet_status,cabinet_case,hippo_status'];
  let hasAriza = 0, hasTalabnoma = 0, hasBoth = 0, hasNeither = 0;
  for (const [pinfl, name] of clients) {
    const c = cabBy.get(pinfl), h = hipBy.get(pinfl);
    if (c) hasAriza++; if (h) hasTalabnoma++;
    if (c && h) hasBoth++; if (!c && !h) hasNeither++;
    rows.push(`${pinfl},"${name}",${c?.status ?? ''},${c?.caseNumber ?? ''},${h?.status ?? ''}`);
  }

  const dir = path.join(process.cwd(), 'exports', 'status-unified');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${branchCode}.csv`), rows.join('\n'));

  console.log(`\n[${branchCode}] court clients: ${clients.size}`);
  console.log(`   has ARIZA (cabinet):     ${hasAriza} (${(hasAriza / clients.size * 100).toFixed(0)}%)`);
  console.log(`   has TALABNOMA (hippo):   ${hasTalabnoma} (${(hasTalabnoma / clients.size * 100).toFixed(0)}%)`);
  console.log(`   has BOTH:                ${hasBoth}`);
  console.log(`   has NEITHER:             ${hasNeither}`);
  return { branchCode, clients: clients.size, hasAriza, hasTalabnoma, hasBoth, hasNeither };
}

async function main() {
  const arg = process.argv[2] ?? '12842';
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  const branches = arg === 'all' ? FIRMS.map((f) => f.branchCode) : [arg];
  const totals = { clients: 0, hasAriza: 0, hasTalabnoma: 0, hasBoth: 0 };
  for (const b of branches) {
    const r = await forFirm(b, snap!.id);
    totals.clients += r.clients; totals.hasAriza += r.hasAriza; totals.hasTalabnoma += r.hasTalabnoma; totals.hasBoth += r.hasBoth;
  }
  if (branches.length > 1) console.log(`\n=== TOTAL: ${totals.clients} clients | ariza ${totals.hasAriza} | talabnoma ${totals.hasTalabnoma} | both ${totals.hasBoth}`);
  console.log(`\nCSV -> exports/status-unified/`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
