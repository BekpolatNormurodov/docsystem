// CLI: log in to xat.hippo.uz with a BRIGHT E-IMZO key.
//   npx tsx scripts/hippo-login.ts            -> first BRIGHT key
//   npx tsx scripts/hippo-login.ts farrux     -> Suvonov Farrux (BRIGHT DS...0001)
//   npx tsx scripts/hippo-login.ts 6          -> key index (see hippo-keys.ts)
//
// The E-IMZO desktop app must be running; type the key password in its window.
import { loginToHippo } from '../src/lib/hippo/login';

async function main() {
  const selector = process.argv[2];
  console.log('Signing — TYPE THE KEY PASSWORD IN THE E-IMZO WINDOW...');
  const s = await loginToHippo(selector);
  console.log(`\n✅ ${s.raw.message || 'logged in'}`);
  console.log(`   key         : ${s.key.info.cn} — ${s.key.info.org}`);
  console.log(`   access_token: ${s.accessToken.slice(0, 40)}…`);
  console.log(`   refresh     : ${String(s.refreshToken).slice(0, 24)}…`);
  console.log(`   expires_in  : ${s.expiresIn}s (${Math.round(s.expiresIn / 86400)}d)  type: ${s.tokenType}`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
