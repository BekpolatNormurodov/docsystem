// Inspect one cabinet case detail to see its full structure (does it expose the
// defendant PINFL / decline reason?). Stored session.
//   npx tsx scripts/cabinet-detail-probe.ts
import fs from 'node:fs';
import path from 'node:path';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';
import { prisma } from '../src/lib/db';

async function main() {
  const s = await getStoredCabinetSession('311976765');
  const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'exports', 'cabinet-statuses', 'civil_all-cases.json'), 'utf8'));
  const cases: any[] = Array.isArray(j) ? j : j.content ?? [];
  const c = cases.find((x) => x.case_id);
  console.log('probing case_id', c.case_id, '| claim_id', c.claim_id, '| status', c.current_status);

  for (const [label, url] of [
    ['by-case_id', `/api/cabinet/case/get-one-case-by-id/${c.case_id}`],
    ['by-claim_id', `/api/cabinet/case/get-one-case-by-id/${c.claim_id}`],
  ] as const) {
    const r = await cabinetFetch(s, url);
    const d: any = r.json ?? {};
    console.log(`\n${label} -> ${r.status}`);
    console.log('  keys:', Object.keys(d).join(', ').slice(0, 400));
    // hunt for pinfl anywhere in the payload
    const str = JSON.stringify(d);
    const pinfls = str.match(/\d{14}/g);
    console.log('  14-digit numbers (pinfl?):', pinfls ? [...new Set(pinfls)].slice(0, 8).join(', ') : 'none');
    if (d.participants) console.log('  participants[0]:', JSON.stringify(d.participants[0]));
    fs.writeFileSync(path.join(process.cwd(), 'exports', `case-detail-${label}.json`), JSON.stringify(d, null, 2));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
