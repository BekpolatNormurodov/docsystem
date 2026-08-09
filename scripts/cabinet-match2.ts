import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';

const norm = (s: string) => String(s || '')
  .toUpperCase().replace(/[‘’`ʻ']/g, '')
  .replace(/O\s*G\s*L[IY]|UGLI|OGLI/g, '').replace(/QIZI|KIZI/g, '')
  .replace(/X/g, 'H').replace(/[^A-ZА-Я ]/g, '').replace(/\s+/g, ' ').trim();

async function main() {
  const s = await getStoredCabinetSession('311976765');
  for (const p of ['', '?PageIndex=1&PageSize=2000', '?page=0&size=2000']) {
    const r = await cabinetFetch(s, '/api/cabinet/case/civil/all-cases' + p);
    const a = Array.isArray(r.json) ? r.json : r.json?.content ?? r.json?.data ?? [];
    console.log(`all-cases${p} -> ${r.status} [${Array.isArray(a) ? a.length : '?'}]`);
  }
  const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'exports', 'cabinet-statuses', 'civil_all-cases.json'), 'utf8'));
  const cases: any[] = Array.isArray(j) ? j : j.content ?? [];
  const defNames = new Map<string, any>();
  for (const c of cases) for (const p of c.participants || []) if (p.type === 'DEFENDANT') defNames.set(norm(p.name), c);
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  const loans = await prisma.loan.findMany({ where: { snapshotId: snap!.id, excluded: true, branchCode: '12842' }, select: { clientName: true, pinfl: true } });
  const seen = new Set<string>(); let hit = 0;
  for (const l of loans) { if (seen.has(l.pinfl!)) continue; seen.add(l.pinfl!); if (defNames.get(norm(l.clientName || ''))) hit++; }
  console.log(`\nfuzzy name match: ${hit}/${seen.size} unique BRIGHT court clients (${(hit / seen.size * 100).toFixed(0)}%), cabinet distinct defendant names=${defNames.size}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
