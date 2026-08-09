// Reuse the STORED cabinet session (no E-IMZO signing) to pull data. Proves the
// DB-backed session works; on expiry it throws SessionExpiredError.
//   npx tsx scripts/cabinet-verify.ts [account=311976765]
import { verifyCabinetSession } from '../src/lib/cabinet/session';
import { getUser, listDrafts, getConflictCases } from '../src/lib/cabinet/api';
import { SessionExpiredError } from '../src/lib/session-store';
import { prisma } from '../src/lib/db';

async function main() {
  const account = process.argv[2] ?? '311976765';
  try {
    const s = await verifyCabinetSession(account); // no signing — uses stored token
    const me = await getUser(s);
    const drafts = await listDrafts(s);
    const cases = await getConflictCases(s);
    console.log(`✅ reused stored session for ${account} — NO signing`);
    console.log('   user       :', me.status, me.json?.fullName);
    const dArr = Array.isArray(drafts.json) ? drafts.json : drafts.json?.content ?? drafts.json?.data ?? [];
    const cArr = Array.isArray(cases.json) ? cases.json : cases.json?.content ?? cases.json?.data ?? [];
    console.log('   drafts     :', drafts.status, Array.isArray(dArr) ? `[${dArr.length}]` : typeof dArr);
    console.log('   conflict   :', cases.status, Array.isArray(cArr) ? `[${cArr.length}]` : typeof cArr);
  } catch (e) {
    if (e instanceof SessionExpiredError) console.log(`⚠️ ${e.message}\n   -> UI should prompt: "E-IMZO orqali qayta tasdiqlang"`);
    else throw e;
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
