// Live proof: create a small BRIGHT registry (draft, autoSend:false) from the
// generated talabnoma Excel, read back how HIPPO stores region/area, compare
// to what we sent, then DELETE. Nothing is dispatched.
//   npx tsx scripts/hippo-registry-live-test.ts [count]   (default 20)
import path from 'node:path';
import os from 'node:os';
import { prisma } from '../src/lib/db';
import { buildTalabnomaRows, writeTalabnomaExcel, type TalabnomaLoan } from '../src/lib/hippo/talabnoma-excel';
import { regionName, areaName } from '../src/core/hippo-regions';
import { loginToHippo } from '../src/lib/hippo/login';
import {
  resolveContext, createRegistryInternal, getRegistry, listRegistryMails, deleteRegistry, readInternalMailsFromExcel,
} from '../src/lib/hippo/xat';

const BRANCH = '12842'; // BRIGHT
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const count = process.argv[2] && /^\d+$/.test(process.argv[2]) ? Number(process.argv[2]) : 20;

  // 1) Build the exact upload Excel for BRIGHT (first `count`), then parse it
  //    back into mails via the SAME importer hippo's frontend uses.
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  const loans = (await prisma.loan.findMany({
    where: { snapshotId: snap!.id, excluded: true, branchCode: BRANCH },
    orderBy: [{ pinfl: 'asc' }, { branchCode: 'asc' }, { id: 'asc' }],
    select: { pinfl: true, branchCode: true, clientName: true, postAddress: true, regionName: true, ldId: true, dateToCr: true, summKr: true, totalDebt: true, raw: true },
  })) as TalabnomaLoan[];
  const rows = buildTalabnomaRows(loans, new Date()).slice(0, count);
  const tmp = path.join(os.tmpdir(), `bright_live_${count}.xlsx`);
  await writeTalabnomaExcel(rows, tmp);

  // 2) Login + resolve org/branch/template.
  console.log('Signing — TYPE THE FARRUX KEY PASSWORD IN THE E-IMZO WINDOW...');
  const s = await loginToHippo('farrux');
  const ctx = await resolveContext(s);
  console.log(`✅ ${s.key.info.cn} | org=${ctx.organizationId} branch=${ctx.branchId} template="${ctx.templateName}"`);

  const mails = await readInternalMailsFromExcel(tmp, ctx.templateName, { take: count });
  console.log(`sending ${mails.length} mails (autoSend:false)\n`);

  // 3) Create (draft).
  const created = await createRegistryInternal(s, { organizationId: ctx.organizationId, branchId: ctx.branchId, autoSend: false, mails });
  const d = created.json?.data ?? created.json ?? {};
  const registryId = d.registryId ?? d.id;
  console.log(`CREATE [${created.status}] ${created.json?.message ?? ''} registryId=${registryId} queued=${d.queuedCount}`);
  if (!registryId) { console.log('no registryId — abort'); return; }

  // 4) Poll until hippo has processed the mails into the registry (async), then
  //    read back how it stored region/area. Up to ~2 min.
  let items: any[] = [];
  let reg: any;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    reg = (await getRegistry(s, registryId)).json;
    const rm = await listRegistryMails(s, registryId, 1, count);
    items = Array.isArray(rm.json) ? rm.json : rm.json?.data?.items ?? rm.json?.items ?? rm.json?.data ?? [];
    process.stdout.write(`\r  polling… status=${reg?.status} processed=${reg?.processedCount}/${reg?.totalCount} mails=${items.length}   `);
    if (items.length >= mails.length) break;
  }
  console.log(`\nregistry status=${reg?.status} processed=${reg?.processedCount}/${reg?.totalCount}\n`);
  console.log('COMPARE — sent (our IDs) vs hippo (stored):');
  console.log('receiver'.padEnd(34), 'sent r/a', ' hippo r/a', ' region -> area');
  const byName = new Map(items.map((m) => [String(m.receiverName), m]));
  let match = 0;
  for (const mail of mails) {
    const hip = byName.get(mail.receiver);
    const hr = hip?.regionId, ha = hip?.areaId;
    const ok = hr === mail.regionId && ha === mail.areaId;
    if (ok) match++;
    console.log(
      String(mail.receiver).slice(0, 33).padEnd(34),
      `${mail.regionId}/${mail.areaId}`.padEnd(9),
      `${hr ?? '-'}/${ha ?? '-'}`.padEnd(10),
      `${regionName(mail.regionId)} -> ${areaName(mail.areaId)}`,
      ok ? '' : '  ⚠️ DIFF',
    );
  }
  console.log(`\nregion/area match: ${match}/${mails.length}`);

  // 5) Delete.
  const del = await deleteRegistry(s, registryId);
  console.log(`\nDELETE [${del.status}] ${del.json?.message ?? JSON.stringify(del.json)}`);
  const gone = await getRegistry(s, registryId);
  console.log(`verify gone: [${gone.status}] ${JSON.stringify(gone.json).slice(0, 80)}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
