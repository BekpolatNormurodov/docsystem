// Talabnoma bo'shliqlarini to'ldirish — firma bo'yicha (oxirgi snapshot):
//   1) talabnomaAt yo'q, lekin SHU firma kodida pochtaga CHIQQAN hippo talabnomasi bor VA
//      UZPOST check (TALABNOMA_RECEIPT) allaqachon biriktirilgan ishlar → talabnomaAt shu
//      xatning reyestr sanasi bilan to'ldiriladi (yuborilgani ikki manbadan isbotlangan).
//   2) Hippo yetkazgan xatni oldindan yuklab CaseDocument(TALABNOMA_HIPPO) qilib biriktiradi
//      (hippo/attach-letters.ts) — sud va firma-zip endi xat.hippo'ga jonli chiqmaydi.
// Shu firmadan hippo xati umuman yo'q ishlar faqat SANALADI: ularga o'z talabnomasi hali
// yuborilmagan, boshqa kreditorning xatini biriktirib bo'lmaydi.
//
//   npx tsx scripts/talabnoma-letters-prefetch.ts [firmIds=1,3] [--dry] [--limit=N]
import { prisma } from '../src/lib/db';
import { attachTalabnomaLetters, planLetters } from '../src/lib/hippo/attach-letters';
import { isDispatched } from '../src/lib/hippo/talabnoma-fetch';

async function fixTalabnomaDates(firmId: number, dry: boolean): Promise<number> {
  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { code: true } });
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } });
  if (!firm?.code || !snap) return 0;
  const cases = await prisma.arizaCase.findMany({
    where: { firmId, snapshotId: snap.id, talabnomaAt: null, pinfl: { not: null },
      documents: { some: { kind: 'TALABNOMA_RECEIPT' } } },
    select: { id: true, pinfl: true },
  });
  if (!cases.length) return 0;
  const rows = await prisma.clientCaseStatus.findMany({
    where: {
      source: 'HIPPO', category: 'talabnoma', branchCode: firm.code, pinfl: { in: cases.map((c) => c.pinfl!) },
      caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } },
    },
    select: { pinfl: true, status: true, registryDt: true },
  });
  const earliest = new Map<string, Date>();
  for (const r of rows) {
    // Sana faqat haqiqiy yuborilgan sanadan (registryDt) — updatedAt oxirgi sync vaqti, u soxta sana bo'lardi.
    if (!r.pinfl || !isDispatched(r.status) || !r.registryDt) continue;
    const at = r.registryDt;
    const cur = earliest.get(r.pinfl);
    if (!cur || at < cur) earliest.set(r.pinfl, at);
  }
  let fixed = 0;
  for (const c of cases) {
    const at = earliest.get(c.pinfl!);
    if (!at) continue;
    if (!dry) await prisma.arizaCase.updateMany({ where: { id: c.id, talabnomaAt: null }, data: { talabnomaAt: at } });
    fixed++;
  }
  return fixed;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  const firmIds = (args.find((a) => /^\d+(,\d+)*$/.test(a)) ?? '1,3').split(',').map(Number);

  for (const firmId of firmIds) {
    const plan = await planLetters(firmId);
    console.log(`\n== ${plan.firm.shortName} (firma ${firmId}) ==`);
    console.log(`  yetkazilgan o'z xati bor: ${plan.candidates} · allaqachon biriktirilgan: ${plan.attached} · yuklanadi: ${plan.list.length}`);
    console.log(`  o'z xati bor, lekin yetkazilmagan (sudda jonli olinadi): ${plan.notDelivered}`);
    console.log(`  o'z talabnomasi YUBORILMAGAN (hippo'da shu firmadan yozuv yo'q): ${plan.noOwnLetter}`);

    const fixed = await fixTalabnomaDates(firmId, dry);
    console.log(`  talabnomaAt ${dry ? 'tuzatiladi' : 'tuzatildi'} (hippo sanasi bilan): ${fixed}`);
    if (dry) continue;

    const t0 = Date.now();
    const r = await attachTalabnomaLetters(firmId, {
      concurrency: 3, limit,
      onProgress: (done, total, x) => {
        if (done % 100 === 0 || done === total) {
          console.log(`  ${done}/${total} · +${x.attached} biriktirildi · ${x.missing} ochilmadi · ${x.failed} xato · ${Math.round((Date.now() - t0) / 1000)}s`);
        }
      },
    });
    console.log(`  NATIJA: +${r.attached} biriktirildi · ${r.missing} ochilmadi · ${r.failed} xato (jami ${r.todo})`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error('✗', e instanceof Error ? e.message : e); process.exit(1); });
