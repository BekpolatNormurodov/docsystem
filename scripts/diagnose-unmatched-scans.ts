/**
 * diagnose-unmatched-scans.ts — «Mos ish topilmadi» skanlar NEGA case topmaganini buketlarga
 * ajratadi (read-only). palata-attach mantiqi bilan bir xil firm-resolve.
 *   node --import tsx scripts/diagnose-unmatched-scans.ts
 */
import { prisma } from '../src/lib/db';
import { readScannedArizas } from '../src/lib/palata-scan';

async function main() {
  const arizas = readScannedArizas().filter((a) => a.pinfl);
  const firms = await prisma.firm.findMany({ select: { id: true, shortName: true } });
  const resolveFirmId = (firmKey: string): number | null => {
    const k = (firmKey || '').toUpperCase();
    return k ? (firms.find((x) => (x.shortName || '').toUpperCase().includes(k))?.id ?? null) : null;
  };
  const latest = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true, reportDate: true } });
  const latestId = latest?.id;

  const pinfls = [...new Set(arizas.map((a) => a.pinfl))];
  const cases = await prisma.arizaCase.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, firmId: true, snapshotId: true } });
  const firmsByPinfl = new Map<string, Set<number>>();
  const snapsByPinfl = new Map<string, Set<number>>();
  for (const c of cases) {
    if (!c.pinfl) continue;
    (firmsByPinfl.get(c.pinfl) ?? firmsByPinfl.set(c.pinfl, new Set()).get(c.pinfl)!).add(c.firmId);
    (snapsByPinfl.get(c.pinfl) ?? snapsByPinfl.set(c.pinfl, new Set()).get(c.pinfl)!).add(c.snapshotId ?? 0);
  }
  const pairSet = new Set(cases.map((c) => `${c.pinfl}::${c.firmId}`));
  const pair2508 = new Set(cases.filter((c) => c.snapshotId === latestId).map((c) => `${c.pinfl}::${c.firmId}`));

  const b = { total: arizas.length, matched_2508: 0, matched_but_old_snap: 0, other_firm: 0, firm_unresolved: 0, no_case_anywhere: 0 };
  const byFirmUnmatched = new Map<string, number>();
  for (const a of arizas) {
    const fid = resolveFirmId(a.firmKey);
    const hasCaseAnywhere = firmsByPinfl.has(a.pinfl);
    if (fid != null && pair2508.has(`${a.pinfl}::${fid}`)) { b.matched_2508++; continue; }
    // unmatched — nega?
    const key = (a.firmKey || '?').toUpperCase();
    byFirmUnmatched.set(key, (byFirmUnmatched.get(key) ?? 0) + 1);
    if (!hasCaseAnywhere) b.no_case_anywhere++;
    else if (fid == null) b.firm_unresolved++;
    else if (pairSet.has(`${a.pinfl}::${fid}`)) b.matched_but_old_snap++; // shu firmada bor, lekin 25.08 emas
    else b.other_firm++;                                                   // boshqa firmada bor
  }

  console.log('latest snapshot:', latestId, latest?.reportDate);
  console.log('Jami skan (pinflli):', b.total);
  console.log('  25.08 case topildi        :', b.matched_2508);
  console.log('  --- MOS KELMAGAN sabablar ---');
  console.log('  pinfl UMUMAN case yoʻq  :', b.no_case_anywhere, '(portfelda yoʻq / oʻchirilgan / import qilinmagan)');
  console.log('  boshqa FIRMADA case bor   :', b.other_firm, '(skan firmKey notoʻgʻri yoki mijoz boshqa firmada)');
  console.log('  shu firmada ESKI snapshot :', b.matched_but_old_snap, '(31.07 da bor, 25.08 da yoʻq)');
  console.log('  firmKey aniqlanmadi       :', b.firm_unresolved);
  console.log('  --- mos kelmaganlar firmKey boʻyicha ---');
  for (const [k, v] of [...byFirmUnmatched.entries()].sort((a, c) => c[1] - a[1])) console.log(`    ${k}: ${v}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
