// Live status board for xat.hippo registries (talabnoma batches): grouped
// counts + per-registry sent/receipt progress. Read-only.
//   npx tsx scripts/hippo-status.ts [expectedCount]
// If expectedCount is given, flags registries whose total != expected.
import { loginToHippo } from '../src/lib/hippo/login';
import { listRegistries, getAutoSendStatus, listReceiptRefs, checkBalanceFor } from '../src/lib/hippo/xat';
import { summarizeRegistryMails } from '../src/lib/hippo/mail-status';

const so = (n: number) => n.toLocaleString('ru-RU');

async function main() {
  const expected = process.argv[2] && /^\d+$/.test(process.argv[2]) ? Number(process.argv[2]) : null;
  console.log('Signing — TYPE THE FARRUX KEY PASSWORD IN THE E-IMZO WINDOW...');
  const s = await loginToHippo('farrux');
  console.log(`✅ ${s.key.info.cn}\n`);

  // Balance up top.
  const bal = await checkBalanceFor(s, expected ?? 0);
  console.log(`💰 Balans: ${so(bal.balance)} so'm | 1 xat: ${so(bal.pricePerMail)} so'm${bal.pricePerMail === 0 ? ' (bepul)' : ''}` +
    (expected ? ` | ${expected} ta uchun kerak: ${so(bal.required)} — ${bal.enough ? 'YETADI ✅' : 'YETMAYDI ❌ kamomad ' + so(bal.shortfall)}` : '') + '\n');

  const { json } = await listRegistries(s, { PageIndex: 1, PageSize: 50 });
  const items: any[] = Array.isArray(json) ? json : json?.data ?? json?.items ?? [];
  console.log(`Registries: ${items.length}\n`);
  console.log('ID   TYPE        STATUS      TOTAL  DONE   ERR   name');
  const byStatus = new Map<string, number>();
  for (const r of items) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    const flag = expected != null && r.totalCount !== expected ? `  ⚠️ expected ${expected}` : '';
    console.log(
      `${String(r.id).padEnd(4)} ${String(r.source ?? '').padEnd(11)} ${String(r.status ?? '').padEnd(11)} ` +
      `${String(r.totalCount ?? 0).padStart(5)} ${String(r.processedCount ?? 0).padStart(5)} ${String(r.errorCount ?? 0).padStart(5)}  ${r.name ?? ''}${flag}`,
    );
  }
  console.log('\nGrouped by status:', [...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join('  '));

  // Deep-check the newest completed registry: lifecycle status breakdown.
  const done = items.find((r) => r.status === 'Completed') ?? items[0];
  if (done) {
    console.log(`\nDeep check registry #${done.id} (${done.name}):`);
    const st = await getAutoSendStatus(s, done.id);
    console.log('  auto-send-status:', JSON.stringify(st.json));
    const sum = await summarizeRegistryMails(s, done.id);
    console.log(`  Jami: ${sum.total} | Jo'natildi: ${sum.sent} | Qoralama: ${sum.draft}`);
    console.log(`  Yetkazilgan: ${sum.delivered} | Xato: ${sum.failed} | Natija kutilmoqda: ${sum.pendingPerform}`);
    console.log('  Status bo\'yicha:');
    for (const [label, n] of Object.entries(sum.byPerform).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${label}`);
    const refs = await listReceiptRefs(s, done.id);
    console.log(`  Kvitansiya olsa bo'ladigan xatlar: ${refs.length}`);
  }
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
