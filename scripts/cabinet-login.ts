// OneID e-key -> cabinet.sud.uz login (full REST) + verify the session.
//   npx tsx scripts/cabinet-login.ts [keySelector]
// The E-IMZO native password dialog pops up — TYPE THE KEY PASSWORD THERE.
import { loginToCabinet } from '../src/lib/cabinet/oneid';
import { getUser } from '../src/lib/cabinet/api';

async function main() {
  const selector = process.argv[2]; // index, or CN/file substring; default BRIGHT
  console.log('Signing — TYPE THE KEY PASSWORD IN THE E-IMZO WINDOW...\n');
  const s = await loginToCabinet(selector);
  console.log('✅ cabinet.sud.uz login');
  console.log('   key    :', s.key.info.cn, `(${s.key.info.org ?? '-'})`);
  console.log('   user   :', s.user.username, '| entity:', s.user.entityId, '| advocate:', s.user.isAdvocate);
  console.log('   token  :', s.token);

  const me = await getUser(s);
  console.log('\n/api/cabinet/user/get ->', me.status,
    me.ok ? `✅ ${me.json?.fullName}` : JSON.stringify(me.json).slice(0, 160));
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
