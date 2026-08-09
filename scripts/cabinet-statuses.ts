// Full status board of all cabinet.sud.uz claims/materials for this org: pulls
// every case-list category + drafts, groups by status, and lists each claim with
// its current status/result. Reuses the stored session (no signing).
//   npx tsx scripts/cabinet-statuses.ts [account=311976765]
import fs from 'node:fs/promises';
import path from 'node:path';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';
import { prisma } from '../src/lib/db';

// Uzbek labels — the REAL cabinet claim statuses (verified from live data).
const STATUS_UZ: Record<string, string> = {
  DRAFT: 'Qoralama',
  CREATED: 'Yaratilgan (yuborilgan)',
  PENDING: 'Kutilmoqda',
  IN_PROCESS: 'Ko‘rib chiqilmoqda',
  DECIDED: 'Qaror chiqarilgan',
  FINISHED: 'Yakunlangan',
  DECLINED: 'Rad etilgan',
  RETURNED: 'Qaytarilgan',
  REPEATED_INSPECTION: 'Qayta ko‘rik',
};
const label = (s?: string) => (s ? `${s}${STATUS_UZ[s] ? ' (' + STATUS_UZ[s] + ')' : ''}` : '—');

const CATS = ['civil', 'economic', 'administrative', 'conflict'] as const;
const LISTS = ['first-materials', 'first-non-material-cases', 'all-cases'] as const;

function asArray(j: any): any[] {
  return Array.isArray(j) ? j : Array.isArray(j?.content) ? j.content : Array.isArray(j?.data) ? j.data : [];
}

async function main() {
  const account = process.argv[2] ?? '311976765';
  const s = await getStoredCabinetSession(account);
  const dir = path.join(process.cwd(), 'exports', 'cabinet-statuses');
  await fs.mkdir(dir, { recursive: true });

  const byStatus = new Map<string, number>();
  const rows: any[] = [];

  // drafts
  const drafts = await cabinetFetch(s, '/api/cabinet/pub-user-draft-cases/list');
  const dArr = asArray(drafts.json);
  for (const d of dArr) { byStatus.set('DRAFT', (byStatus.get('DRAFT') ?? 0) + 1); rows.push({ cat: 'draft', list: '-', status: 'DRAFT', id: d.id, number: d.form_step }); }
  console.log(`drafts: ${drafts.status} [${dArr.length}]`);

  for (const cat of CATS) for (const list of LISTS) {
    const r = await cabinetFetch(s, `/api/cabinet/case/${cat}/${list}`);
    const arr = asArray(r.json);
    if (r.status !== 200) { console.log(`${cat}/${list}: ${r.status} ${JSON.stringify(r.json).slice(0, 70)}`); continue; }
    await fs.writeFile(path.join(dir, `${cat}_${list}.json`), JSON.stringify(r.json, null, 2));
    for (const c of arr) {
      const st = c.current_status ?? c.status ?? c.case_result ?? 'UNKNOWN';
      byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
      rows.push({ cat, list, status: st, number: c.case_number ?? c.registry_number, result: c.case_result, court: c.court_id, kind: c.claim_kind, instance: c.instance });
    }
    console.log(`${cat}/${list}: 200 [${arr.length}]`);
  }

  console.log('\n=== STATUS BO‘YICHA (full) ===');
  for (const [st, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(4)}  ${label(st)}`);

  console.log('\n=== har bir ish (namuna, 30 ta) ===');
  for (const r of rows.slice(0, 30))
    console.log(`  ${r.cat}/${r.list}  ${label(r.status)}  #${r.number ?? r.id ?? '-'}  ${r.kind ?? ''} ${r.instance ?? ''}`);
  console.log(`\ntotal claims/materials: ${rows.length}  (JSON -> ${dir})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
