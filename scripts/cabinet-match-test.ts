// Test how to link a portfolio client (31.07 snapshot, court list) to their real
// cabinet case + status: (a) server search by pinfl via all-cases-by-params,
// (b) name match against the pulled all-cases list. Read-only, stored session.
//   npx tsx scripts/cabinet-match-test.ts
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';

const norm = (s: string) => String(s || '').toUpperCase().replace(/[‘’`']/g, "'").replace(/\s+/g, ' ').trim();

async function main() {
  const s = await getStoredCabinetSession('311976765');

  // sample BRIGHT (12842) court clients from the latest snapshot
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  const loans = await prisma.loan.findMany({
    where: { snapshotId: snap!.id, excluded: true, branchCode: '12842' },
    select: { pinfl: true, clientName: true }, take: 5,
  });
  console.log('snapshot', snap!.reportDate.toISOString().slice(0, 10), '— sample BRIGHT court clients:');
  loans.forEach((l) => console.log('  ', l.pinfl, l.clientName));
  const sample = loans[0];

  // (a) server search by pinfl — try several param names
  console.log('\n(a) all-cases-by-params search for pinfl', sample.pinfl, ':');
  for (const key of ['pinfl', 'pinflOrInn', 'defendantPinfl', 'search', 'keyword', 'query']) {
    const r = await cabinetFetch(s, `/api/cabinet/case/civil/all-cases-by-params?${key}=${sample.pinfl}`);
    const arr = Array.isArray(r.json) ? r.json : r.json?.content ?? r.json?.data ?? [];
    console.log(`  ?${key}= -> ${r.status} ${Array.isArray(arr) ? `[${arr.length}]` : JSON.stringify(r.json).slice(0, 80)}`);
  }

  // (b) name match against the already-pulled civil all-cases
  const file = path.join(process.cwd(), 'exports', 'cabinet-statuses', 'civil_all-cases.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cases: any[] = Array.isArray(j) ? j : j.content ?? j.data ?? [];
  const defNames = new Map<string, any>();
  for (const c of cases) for (const p of c.participants || []) if (p.type === 'DEFENDANT') defNames.set(norm(p.name), c);
  console.log(`\n(b) name match: ${cases.length} civil cases, ${defNames.size} distinct defendant names`);
  let hit = 0;
  const allLoans = await prisma.loan.findMany({ where: { snapshotId: snap!.id, excluded: true, branchCode: '12842' }, select: { clientName: true, pinfl: true } });
  const seen = new Set<string>();
  for (const l of allLoans) {
    if (seen.has(l.pinfl!)) continue; seen.add(l.pinfl!);
    const c = defNames.get(norm(l.clientName || ''));
    if (c) hit++;
  }
  console.log(`  BRIGHT court clients (unique pinfl): ${seen.size}, matched by name to a cabinet case: ${hit} (${((hit / seen.size) * 100).toFixed(0)}%)`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
