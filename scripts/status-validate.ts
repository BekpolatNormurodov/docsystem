// Validate the status pulls & matching against the 31.07 snapshot: correct
// snapshot, name-collision risk (a normalised name mapping to >1 pinfl -> possible
// wrong match), and match integrity. Read-only.
//   npx tsx scripts/status-validate.ts [branchCode=12842]
import { prisma } from '../src/lib/db';
import { latinToCyrillic } from '../src/core/uz-latin-to-cyrillic';
import { normName } from '../src/lib/cabinet/status-ingest';

async function main() {
  const branchCode = process.argv[2] ?? '12842';
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  console.log(`latest snapshot = ${snap!.reportDate.toISOString().slice(0, 10)} (id ${snap!.id})`);

  const loans = await prisma.loan.findMany({ where: { snapshotId: snap!.id, branchCode }, select: { clientName: true, pinfl: true } });
  // collision check: normName -> set of pinfls
  const latinIdx = new Map<string, Set<string>>();
  const cyrIdx = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => { if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(v); };
  for (const l of loans) {
    if (!l.clientName || !l.pinfl) continue;
    add(latinIdx, normName(l.clientName), l.pinfl);
    add(cyrIdx, normName(latinToCyrillic(l.clientName)), l.pinfl);
  }
  const collLatin = [...latinIdx.values()].filter((s) => s.size > 1).length;
  const collCyr = [...cyrIdx.values()].filter((s) => s.size > 1).length;
  const uniquePinfl = new Set(loans.map((l) => l.pinfl)).size;
  console.log(`\nportfolio ${branchCode}: ${loans.length} loans, ${uniquePinfl} unique pinfl`);
  console.log(`  name collisions (same normName, different pinfl): Latin ${collLatin}, Cyrillic ${collCyr}`);
  console.log(`  -> these are the only names where a match COULD be wrong.`);

  // ClientCaseStatus integrity for this firm
  for (const source of ['CABINET', 'HIPPO']) {
    const rows = await prisma.clientCaseStatus.findMany({ where: { source, branchCode }, select: { pinfl: true, status: true, snapshotId: true } });
    const matched = rows.filter((r) => r.pinfl).length;
    const wrongSnap = rows.filter((r) => r.snapshotId && r.snapshotId !== snap!.id).length;
    const byStatus = new Map<string, number>();
    for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    console.log(`\n${source}: ${rows.length} rows, matched ${matched} (${(matched / rows.length * 100).toFixed(0)}%), from-old-snapshot ${wrongSnap}`);
    console.log('  statuses:', [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
