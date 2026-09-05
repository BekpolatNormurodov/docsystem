/**
 * diagnose-hippo-ctx.ts — 3 firma (URBAN/COMMUNITY/BRIGHT) uchun xat.hippo context'ini
 * (org/branch/template) va mavjud reyestrlarning org/branch'ini solishtiradi — Bright nega
 * «Invalid targeting» berishini aniqlash uchun (read-only).
 *   node --import tsx scripts/diagnose-hippo-ctx.ts
 */
import { prisma } from '../src/lib/db';
import { getStoredHippoSession } from '../src/lib/hippo/session';
import { resolveContext, listRegistries } from '../src/lib/hippo/xat';
import { hippoTemplateIdByStir } from '../src/lib/firms';

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

async function main() {
  const firms = await prisma.firm.findMany({
    where: { shortName: { in: ['URBAN FINANCE SOLUTIONS', 'COMMUNITY MMT', 'BRIGHT FUTURE FINANCING'] } },
    select: { id: true, shortName: true, stir: true, code: true },
  });
  for (const f of firms) {
    console.log('\n==================', f.shortName, '(stir', digits(f.stir), ') ==================');
    let session;
    try { session = await getStoredHippoSession(digits(f.stir)); }
    catch (e) { console.log('  ✗ sessiya yo‘q:', e instanceof Error ? e.message : e); continue; }
    const templateId = hippoTemplateIdByStir(f.stir ?? '');
    try {
      const ctx = await resolveContext(session, 'talabnoma', templateId);
      console.log(`  CTX → templateId=${ctx.templateId} name="${ctx.templateName}" org=${ctx.organizationId} branch=${ctx.branchId}`);
    } catch (e) { console.log('  ✗ resolveContext:', e instanceof Error ? e.message : e); }
    try {
      const list = await listRegistries(session, { PageIndex: 1, PageSize: 12 });
      const arr: any[] = Array.isArray(list.json) ? list.json : list.json?.data?.items ?? list.json?.items ?? list.json?.data ?? [];
      console.log(`  Reyestrlar (${arr.length}): org/branch juftliklari:`);
      const seen = new Map<string, number>();
      for (const r of arr) {
        const org = r?.organizationId ?? r?.organization?.id ?? r?.orgId ?? '?';
        const br = r?.branchId ?? '?';
        const k = `org=${org} branch=${br}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      for (const [k, v] of seen) console.log(`     ${k}  ×${v}`);
    } catch (e) { console.log('  ✗ listRegistries:', e instanceof Error ? e.message : e); }
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
