// Show the live xat.hippo balance and whether N mails are affordable, with
// exact numbers ("balance yetmaydi 200 taga" style).
//   npx tsx scripts/hippo-balance-check.ts [count]   (default 200)
import { loginToHippo } from '../src/lib/hippo/login';
import { checkBalanceFor, getBalance } from '../src/lib/hippo/xat';

const so = (n: number) => n.toLocaleString('ru-RU');

async function main() {
  const count = process.argv[2] && /^\d+$/.test(process.argv[2]) ? Number(process.argv[2]) : 200;
  console.log('Signing — TYPE THE FARRUX KEY PASSWORD IN THE E-IMZO WINDOW...');
  const s = await loginToHippo('farrux');
  if (process.argv.includes('--raw')) console.log('\nRAW:', JSON.stringify((await getBalance(s)).json));
  const c = await checkBalanceFor(s, count);

  console.log(`\n${s.key.info.org}`);
  console.log(`Balans        : ${so(c.balance)} so'm`);
  console.log(`Kredit summa  : ${so(c.creditAmount)} so'm (${c.allowCredit ? 'ruxsat bor' : 'ruxsat yo\'q'})`);
  console.log(`Tarif         : asosiy ${so(c.basePrice)} (${c.includedPages} sahifa) + qo'shimcha sahifa ${so(c.extraPagePrice)}`);
  console.log(`1 xat narxi   : ${so(c.pricePerMail)} so'm`);
  console.log(`Jami mavjud   : ${so(c.spendable)} so'm`);
  console.log('─'.repeat(44));
  console.log(`${count} ta xat uchun kerak: ${so(c.required)} so'm`);
  if (c.pricePerMail === 0) {
    console.log(`✅ Hozirgi tarif BEPUL (0 so'm) — balans kamaymaydi.`);
  } else if (c.enough) {
    console.log(`✅ YETADI. Yuborilgach qoladi: ${so(c.spendable - c.required)} so'm`);
  } else {
    console.log(`❌ YETMAYDI. Kamomad: ${so(c.shortfall)} so'm`);
    console.log(`   Hozirgi balansga ${c.maxAffordable} ta xat yuborish mumkin.`);
  }
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
