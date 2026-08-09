// CLI: list all E-IMZO keys visible to the local client (scans <disk>:\DSKEYS).
//   npx tsx scripts/hippo-keys.ts
import { listAllKeys } from '../src/lib/hippo/eimzo';

async function main() {
  const keys = await listAllKeys();
  console.log(`Found ${keys.length} key(s):\n`);
  keys.forEach((k, i) => {
    const bright = /bright/i.test(k.info.org || '');
    console.log(`[${i}] ${bright ? '⭐ ' : ''}${k.info.cn || k.name}`);
    console.log(`     org : ${k.info.org || '-'}`);
    console.log(`     role: ${k.info.role || '-'}   TIN: ${k.info.tin || '-'}   PINFL: ${k.info.pinfl || '-'}`);
    console.log(`     valid: ${k.info.validFrom || '?'} → ${k.info.validTo || '?'}`);
    console.log(`     file: ${k.disk}${k.path}\\${k.name}\n`);
  });
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
