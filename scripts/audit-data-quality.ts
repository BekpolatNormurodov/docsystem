// Dataset-wide error-surface scan, done in SQL (no fat `raw` blobs loaded into
// Node) — how many real loans would produce a BROKEN document:
//   unresolved hippo region/area (import rejected), null contract date, no address.
//   npx tsx scripts/audit-data-quality.ts
import { prisma } from '@/lib/db';
import { resolveHippoRegionArea } from '@/core/hippo-regions';

const N = (x: unknown) => Number(x as any);

async function main() {
  const snap = await prisma.snapshot.findFirst({ orderBy: { id: 'desc' } });
  if (!snap) { console.log('no snapshot'); return; }
  const sid = snap.id;

  const [{ total }] = await prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) total FROM Loan WHERE snapshotId = ${sid}`;
  console.log(`snapshot #${sid} loans=${N(total)}`);

  // DISTINCT (regionName, distr_name) with counts — resolve each combo in JS.
  const combos = await prisma.$queryRaw<{ region: string | null; distr: string | null; n: bigint }[]>`
    SELECT regionName AS region, JSON_UNQUOTE(JSON_EXTRACT(raw, '$.distr_name')) AS distr, COUNT(*) AS n
    FROM Loan WHERE snapshotId = ${sid}
    GROUP BY regionName, JSON_UNQUOTE(JSON_EXTRACT(raw, '$.distr_name'))`;

  let unresolvedRegion = 0, unresolvedArea = 0;
  const badSamples: string[] = [];
  for (const c of combos) {
    const { regionId, areaId } = resolveHippoRegionArea(c.region ?? '', c.distr ?? '');
    if (regionId === 0) unresolvedRegion += N(c.n);
    if (areaId === 0) { unresolvedArea += N(c.n); if (badSamples.length < 20) badSamples.push(`region="${c.region}" distr="${c.distr}" (${N(c.n)} loans)`); }
  }
  console.log(`\nDISTINCT region/area combos: ${combos.length}`);
  console.log(`  loans with UNRESOLVED region (regionId=0): ${unresolvedRegion}`);
  console.log(`  loans with UNRESOLVED area   (areaId=0):   ${unresolvedArea}`);
  for (const s of badSamples) console.log('    !! ' + s);

  const [agg] = await prisma.$queryRaw<{ nullDate: bigint; noAddr: bigint; noUz: bigint; nullName: bigint; nullPinfl: bigint; nullBranch: bigint }[]>`
    SELECT
      SUM(dateToCr IS NULL) nullDate,
      SUM((postAddressUz IS NULL OR TRIM(postAddressUz)='') AND (postAddress IS NULL OR TRIM(postAddress)='')) noAddr,
      SUM(postAddressUz IS NULL OR TRIM(postAddressUz)='') noUz,
      SUM(clientName IS NULL OR TRIM(clientName)='') nullName,
      SUM(pinfl IS NULL OR TRIM(pinfl)='') nullPinfl,
      SUM(branchCode IS NULL OR TRIM(branchCode)='') nullBranch
    FROM Loan WHERE snapshotId = ${sid}`;
  console.log(`\nloans NULL dateToCr (ariza contract date → "Invalid Date"?): ${N(agg.nullDate)}`);
  console.log(`loans NO address (uz+raw both empty):                     ${N(agg.noAddr)}`);
  console.log(`loans missing postAddressUz (fall back to raw):           ${N(agg.noUz)}`);
  console.log(`loans NULL clientName: ${N(agg.nullName)}`);
  console.log(`loans NULL pinfl:      ${N(agg.nullPinfl)}`);
  console.log(`loans NULL branchCode: ${N(agg.nullBranch)}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
