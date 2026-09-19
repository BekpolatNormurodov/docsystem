// Talabnoma bo'shliqlarini to'ldirish — firma bo'yicha (oxirgi snapshot), QO'LDA. Xuddi shu ish
// worker'ning soatlik hippo siklida AVTOMAT ham bajariladi (src/worker/index.ts); bu skript —
// darhol hammasini (limitsiz) tortish yoki quruq (--dry) hisob uchun:
//   1) talabnomaAt yo'q, lekin SHU firma kodida pochtaga CHIQQAN hippo talabnomasi bor VA
//      UZPOST check (TALABNOMA_RECEIPT) allaqachon biriktirilgan ishlar → talabnomaAt shu
//      xatning reyestr sanasi bilan to'ldiriladi (hippo/attach-letters.ts backfillTalabnomaDates).
//   2) Hippo yetkazgan xatni oldindan yuklab CaseDocument(TALABNOMA_HIPPO) qilib biriktiradi
//      (hippo/attach-letters.ts) — sud va firma-zip endi xat.hippo'ga jonli chiqmaydi.
// Shu firmadan hippo xati umuman yo'q ishlar faqat SANALADI: ularga o'z talabnomasi hali
// yuborilmagan, boshqa kreditorning xatini biriktirib bo'lmaydi.
//
//   npx tsx scripts/talabnoma-letters-prefetch.ts [firmIds=1,3] [--dry] [--limit=N]
import { prisma } from '../src/lib/db';
import { attachTalabnomaLetters, backfillTalabnomaDates, planLetters } from '../src/lib/hippo/attach-letters';

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
    console.log(`  o'z xati bor, lekin birortasi ham yetkazilmagan (sudda jonli olinadi): ${plan.notDelivered}`);
    console.log(`  o'z talabnomasi YUBORILMAGAN (hippo'da shu firmadan yozuv yo'q): ${plan.noOwnLetter}`);

    const fixed = await backfillTalabnomaDates(firmId, { dry });
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
