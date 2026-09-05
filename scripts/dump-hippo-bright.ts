/**
 * dump-hippo-bright.ts — Bright hippo hisobining XOM (raw) obyektlarini ko'rsatadi:
 * template 42, bitta reyestrning to'liq JSON'i (org/branch qaysi maydonlarda), va org ro'yxati.
 * Maqsad: resolveContext qaysi id'ni noto'g'ri olayotganini aniqlash (read-only).
 *   node --import tsx scripts/dump-hippo-bright.ts
 */
import { prisma } from '../src/lib/db';
import { getStoredHippoSession } from '../src/lib/hippo/session';
import { getTemplates, listRegistries, getRegistry, getMyOrganizations, getMyBranches } from '../src/lib/hippo/xat';

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
const J = (x: any) => { try { return JSON.stringify(x, null, 1).slice(0, 2500); } catch { return String(x); } };

async function main() {
  const f = await prisma.firm.findFirst({ where: { shortName: { contains: 'BRIGHT' } }, select: { shortName: true, stir: true } });
  if (!f) throw new Error('Bright topilmadi');
  const s = await getStoredHippoSession(digits(f.stir));
  console.log('=== BRIGHT', f.shortName, 'stir', digits(f.stir), '===');

  const tpl = await getTemplates(s);
  const tplArr: any[] = Array.isArray(tpl.json) ? tpl.json : tpl.json?.data ?? tpl.json?.items ?? [];
  console.log('\n--- TEMPLATES (id / name / organizationId / branchId) ---');
  for (const t of tplArr) console.log(`  id=${t?.id} name="${t?.name}" org=${t?.organizationId ?? t?.organization?.id} branch=${t?.branchId ?? t?.branch?.id}`);
  const t42 = tplArr.find((x) => Number(x?.id) === 42);
  console.log('\n--- TEMPLATE 42 to‘liq ---\n', J(t42));

  const list = await listRegistries(s, { PageIndex: 1, PageSize: 3 });
  const arr: any[] = Array.isArray(list.json) ? list.json : list.json?.data?.items ?? list.json?.items ?? list.json?.data ?? [];
  console.log('\n--- REYESTR[0] to‘liq (org/branch qaysi maydonda?) ---\n', J(arr[0]));
  if (arr[0]?.id) {
    const det = await getRegistry(s, arr[0].id);
    console.log('\n--- getRegistry(', arr[0].id, ') to‘liq ---\n', J(det.json));
  }

  try {
    const orgs = await getMyOrganizations(s);
    console.log('\n--- getMyOrganizations ---\n status=', (orgs as any).status, '\n', J((orgs as any).json ?? orgs));
  } catch (e) { console.log('\n--- getMyOrganizations XATO:', e instanceof Error ? e.message : e); }

  try {
    const br = await getMyBranches(s);
    console.log('\n--- getMyBranches (/my-organization-branches) — filial 56 shu yerdami? ---\n status=', (br as any).status, '\n', J((br as any).json ?? br));
  } catch (e) { console.log('\n--- getMyBranches XATO:', e instanceof Error ? e.message : e); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
