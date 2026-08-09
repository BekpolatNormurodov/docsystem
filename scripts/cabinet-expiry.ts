// Report token/session expiry facts for both integrations.
//   npx tsx scripts/cabinet-expiry.ts
import { prisma } from '../src/lib/db';
import { getUser } from '../src/lib/cabinet/api';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';

function decodeJwt(jwt?: string) {
  if (!jwt || jwt.split('.').length < 2) return null;
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8')); } catch { return null; }
}

async function main() {
  const rows = await prisma.externalSession.findMany();
  for (const r of rows) {
    const now = Date.now();
    const ageH = ((now - r.createdAt.getTime()) / 3600000).toFixed(2);
    console.log(`\n=== ${r.provider} / ${r.account} (${r.org ?? ''}) ===`);
    console.log('  created       :', r.createdAt.toISOString(), `| age: ${ageH}h`);
    console.log('  stored status :', r.status, '| lastUsed:', r.lastUsedAt.toISOString());
    console.log('  expiresAt(DB) :', r.expiresAt ? r.expiresAt.toISOString() : 'null (no server expiry — verified per-call)');
    const meta = (r.meta ?? {}) as any;
    const jwt = decodeJwt(meta.oneIdToken ?? meta.jwt?.token);
    if (jwt) {
      const iat = jwt.iat ? new Date(jwt.iat * 1000) : null;
      const exp = jwt.exp ? new Date(jwt.exp * 1000) : null;
      const jwtDead = exp ? exp.getTime() < now : false;
      console.log('  OneID JWT     : iat', iat?.toISOString(), '| exp', exp?.toISOString(),
        exp ? `(${Math.round((exp.getTime() - (iat?.getTime() ?? now)) / 3600000)}h window, ${jwtDead ? 'EXPIRED' : 'valid'})` : '');
    }
    // Empirically test the cabinet SESSION token right now (proves it outlives the JWT).
    if (r.provider === 'CABINET') {
      try {
        const s = await getStoredCabinetSession(r.account);
        const me = await getUser(s);
        console.log(`  session token : LIVE test /user/get -> ${me.status} ${me.ok ? '✅ still valid after ' + ageH + 'h (cabinet session >> 2h OneID JWT)' : '❌ rejected'}`);
      } catch (e: any) { console.log('  session token :', e.message); }
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
