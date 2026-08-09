// Diagnose WHY cabinet defendant names don't match portfolio clients: show
// unmatched cabinet names and the closest portfolio name, to see if it's a
// format issue (fixable) or genuinely different people.
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';

const norm = (s: string) => String(s || '')
  .toUpperCase().replace(/[‘’`ʻ']/g, '').replace(/X/g, 'H')
  .replace(/[^A-ZА-Я ]/g, '').replace(/\s+/g, ' ').trim();
const core = (s: string) => norm(s).replace(/OGL[IY]|UGLI|QIZI|KIZI/g, '').replace(/\s+/g, ' ').trim();

async function main() {
  const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'exports', 'cabinet-statuses', 'civil_all-cases.json'), 'utf8'));
  const cases: any[] = Array.isArray(j) ? j : j.content ?? [];
  const defs = new Set<string>();
  for (const c of cases) for (const p of c.participants || []) if (p.type === 'DEFENDANT' && p.name) defs.add(p.name);

  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  // ALL BRIGHT clients (not just excluded) — maybe some cases are non-court-list clients
  const loans = await prisma.loan.findMany({ where: { snapshotId: snap!.id, branchCode: '12842' }, select: { clientName: true, pinfl: true, excluded: true } });
  const byNorm = new Map<string, any>(), byCore = new Map<string, any>();
  for (const l of loans) { byNorm.set(norm(l.clientName || ''), l); byCore.set(core(l.clientName || ''), l); }

  let exact = 0, coreHit = 0, none = 0; const misses: string[] = [];
  for (const name of defs) {
    if (byNorm.has(norm(name))) exact++;
    else if (byCore.has(core(name))) coreHit++;
    else { none++; if (misses.length < 15) misses.push(name); }
  }
  console.log(`cabinet distinct defendant names: ${defs.size}`);
  console.log(`  exact norm match (any BRIGHT client): ${exact}`);
  console.log(`  core match (ignore o'g'li/qizi): +${coreHit}`);
  console.log(`  NO match: ${none}`);
  console.log('\nsample UNMATCHED cabinet defendant names:');
  misses.forEach((m) => console.log('   -', m));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
