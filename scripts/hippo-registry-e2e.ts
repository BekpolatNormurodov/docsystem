// End-to-end registry test on xat.hippo.uz with the BRIGHT (Farrux) key:
//   login -> discover account/template/org -> CREATE 1 draft registry
//   (autoSend:false, nothing is actually sent) -> check status/mails -> DELETE.
//
//   npx tsx scripts/hippo-registry-e2e.ts
//
// The E-IMZO app must be running; type the Farrux key password in its window.
import { loginToHippo } from '../src/lib/hippo/login';
import {
  getMe, getBalance, getTemplates, getMyOrganizations, getMyBranches,
  listRegistries, getRegistry, getAutoSendStatus, listRegistryMails,
  deleteRegistry, createRegistryInternal, readInternalMailsFromExcel, api,
} from '../src/lib/hippo/xat';
import type { HippoSession } from '../src/lib/hippo/login';

const EXCEL = '/Users/khurshid28/Downloads/Telegram Desktop/talabnoma BRIGHT.xlsx';
const TEMPLATE_HINT = 'talabnoma';

const j = (v: any) => JSON.stringify(v);
const short = (v: any, n = 300) => { const s = j(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };

async function probe(s: HippoSession, label: string, fn: () => Promise<any>) {
  try { const r = await fn(); console.log(`  ${r.ok ? '✓' : '✗'} ${label} [${r.status}] ${short(r.json, 220)}`); return r; }
  catch (e: any) { console.log(`  ✗ ${label} ERR ${e.message}`); return { ok: false }; }
}

function findTemplateName(templatesJson: any): string | null {
  const arr = Array.isArray(templatesJson) ? templatesJson
    : templatesJson?.items ?? templatesJson?.data?.items ?? templatesJson?.data ?? [];
  for (const t of arr) {
    const name = t?.name ?? t?.templateName ?? t?.title ?? (typeof t === 'string' ? t : '');
    if (String(name).toLowerCase().includes(TEMPLATE_HINT)) return String(name);
  }
  return null;
}

async function main() {
  console.log('Signing — TYPE THE FARRUX KEY PASSWORD IN THE E-IMZO WINDOW...');
  const s = await loginToHippo('farrux');
  console.log(`\n✅ logged in: ${s.key.info.cn} — ${s.key.info.org}\n`);

  console.log('— DISCOVERY —');
  const me = await probe(s, 'GET /me', () => getMe(s));
  await probe(s, 'GET /my-balance', () => getBalance(s));
  const tpl = await probe(s, 'GET /template', () => getTemplates(s));
  const orgs = await probe(s, 'GET /my-organizations', () => getMyOrganizations(s));
  await probe(s, 'GET /my-organization-branches', () => getMyBranches(s));
  const br1 = await probe(s, 'GET /branch/mybranch', () => api(s, '/branch/mybranch'));
  const br2 = await probe(s, 'GET /organization/organizationbranches', () => api(s, '/organization/organizationbranches'));
  const reg = await probe(s, 'GET /Registry (list)', () => listRegistries(s, { PageIndex: 1, PageSize: 3 }));

  // Resolve template + organization id.
  const templateName = findTemplateName(tpl.json) || TEMPLATE_HINT;
  const meData = me.json?.data ?? me.json ?? {};
  const orgArr = Array.isArray(orgs.json) ? orgs.json : orgs.json?.data ?? orgs.json?.items ?? [];
  const tplArr = Array.isArray(tpl.json) ? tpl.json : tpl.json?.data ?? tpl.json?.items ?? [];
  const tplForName = tplArr.find((t: any) => String(t?.name ?? '').toLowerCase().includes(TEMPLATE_HINT));
  const organizationId = Number(
    meData.workingOrganizationId ?? meData.organizationId ??
    orgArr?.[0]?.id ?? orgArr?.[0]?.organizationId ??
    tplForName?.organizationId ?? 0,
  );
  console.log(`\n  resolved templateName="${templateName}"  organizationId=${organizationId}`);

  // Inspect an EXISTING accepted registry to learn the real targeting shape.
  console.log('\n— INSPECT EXISTING (reference) —');
  console.log('  template[0] full:', short(tplArr[0], 600));
  const listArr = Array.isArray(reg.json) ? reg.json : reg.json?.data ?? reg.json?.items ?? [];
  const refId = listArr?.[0]?.id;
  let refBranchId = 0;
  if (refId) {
    const det = await getRegistry(s, refId);
    refBranchId = Number(det.json?.branchId ?? det.json?.data?.branchId ?? 0);
    console.log(`  GET /Registry/${refId}:`, short(det.json, 600));
    const rm = await listRegistryMails(s, refId, 1, 1);
    const rmArr = Array.isArray(rm.json) ? rm.json : rm.json?.data?.items ?? rm.json?.items ?? rm.json?.data ?? [];
    console.log(`  first mail of #${refId}:`, short(rmArr?.[0], 700));
  }
  // Resolve a valid branchId: branches endpoint -> else reference registry.
  const brArr = [br1, br2].map((b) => (Array.isArray(b.json) ? b.json : b.json?.data ?? b.json?.items ?? [])).find((a) => a?.length);
  const branchId = Number(brArr?.[0]?.id ?? brArr?.[0]?.branchId ?? refBranchId ?? 0);
  console.log(`  resolved branchId=${branchId}`);

  // Build exactly ONE mail from the talabnoma Excel (first data row).
  const mails = await readInternalMailsFromExcel(EXCEL, templateName, { take: 1 });
  console.log(`  built ${mails.length} mail from Excel:`, short(mails[0], 400));
  if (!mails.length) throw new Error('No mail built from Excel — check header/data rows');
  if (!organizationId) throw new Error('Could not resolve organizationId — inspect /me output above');

  // CREATE (draft only — autoSend:false).
  console.log('\n— CREATE (autoSend:false, draft only) —');
  const created = await createRegistryInternal(s, { organizationId, branchId, autoSend: false, mails });
  console.log(`  [${created.status}] ${short(created.json, 500)}`);
  const d = created.json?.data ?? created.json ?? {};
  const registryId = d.registryId ?? d.registryID ?? d.id ?? d.RegistryId;
  if (!registryId) { console.log('  ⚠️ no registryId in response — stopping before delete.'); return; }
  console.log(`  registryId = ${registryId}`);

  // STATUS checks.
  console.log('\n— STATUS —');
  await probe(s, `GET /Registry/${registryId}`, () => getRegistry(s, registryId));
  await probe(s, `GET /registry/${registryId}/auto-send-status`, () => getAutoSendStatus(s, registryId));
  await probe(s, `GET /mail/all?RegistryId=${registryId}`, () => listRegistryMails(s, registryId));

  // DELETE.
  console.log('\n— DELETE —');
  await probe(s, `DELETE /Registry/${registryId}`, () => deleteRegistry(s, registryId));
  await probe(s, `GET /Registry/${registryId} (should be gone)`, () => getRegistry(s, registryId));
  console.log('\n✅ e2e done');
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
