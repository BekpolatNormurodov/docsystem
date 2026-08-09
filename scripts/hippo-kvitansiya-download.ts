// Download all kvitansiya (delivery-receipt) PDFs for a sent registry into our
// system (exports/kvitansiya_{registryId}/).
//   npx tsx scripts/hippo-kvitansiya-download.ts <registryId>
import fs from 'node:fs/promises';
import path from 'node:path';
import { loginToHippo } from '../src/lib/hippo/login';
import { listReceiptRefs, downloadReceiptPdf } from '../src/lib/hippo/xat';

async function main() {
  const registryId = process.argv[2];
  const limit = process.argv[3] && /^\d+$/.test(process.argv[3]) ? Number(process.argv[3]) : null;
  if (!registryId) throw new Error('Usage: hippo-kvitansiya-download.ts <registryId> [limit]');
  console.log('Signing — TYPE THE FARRUX KEY PASSWORD IN THE E-IMZO WINDOW...');
  const s = await loginToHippo('farrux');
  console.log(`✅ ${s.key.info.cn}\n`);

  let refs = (await listReceiptRefs(s, registryId)).filter((r) => r.isSend !== false);
  console.log(`registry #${registryId}: ${refs.length} sent mails${limit ? ` (downloading first ${limit})` : ''}`);
  if (limit) refs = refs.slice(0, limit);
  const dir = path.join(process.cwd(), 'exports', `kvitansiya_${registryId}`);
  await fs.mkdir(dir, { recursive: true });

  let ok = 0, fail = 0;
  for (const r of refs) {
    try {
      const buf = await downloadReceiptPdf(s, r.uid);
      const safe = `${r.uid}_${String(r.receiverName ?? '').replace(/[^\wА-Яа-яЎўҚқҒғҲҳ]+/g, '_').slice(0, 40)}.pdf`;
      await fs.writeFile(path.join(dir, safe), buf);
      ok++;
    } catch (e: any) { fail++; console.log(`  ✗ ${r.uid}: ${e.message}`); }
  }
  console.log(`\n✅ downloaded ${ok}, failed ${fail} -> ${dir}`);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
