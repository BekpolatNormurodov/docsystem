// Ask the server directly whether/when the token expires — the reliable way (no
// polling). Tries the token-check endpoints with the stored token.
//   npx tsx scripts/cabinet-tokencheck.ts
import { prisma } from '../src/lib/db';
import { CABINET } from '../src/lib/cabinet/config';

async function hit(url: string, token: string, header: string) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', [header]: token } });
    const text = await res.text();
    return `${res.status}  ${text.slice(0, 300)}`;
  } catch (e: any) { return `ERR ${e.message}`; }
}

async function main() {
  const row = await prisma.externalSession.findUnique({ where: { provider_account: { provider: 'CABINET', account: '311976765' } } });
  if (!row) throw new Error('no stored session');
  const token = row.accessToken;
  const meta = (row.meta ?? {}) as any;
  const oneId = meta.oneIdToken as string | undefined;

  console.log('token_id:', token, '\n');
  const targets: [string, string, string][] = [
    [`${CABINET.base_url}/api/token/check`, 'X-AUTH-TOKEN', token],
    [`${CABINET.base_url}/api/token/check`, 'Authorization', token],
    [`${CABINET.xsud_url}/reception/auth/api/token/check`, 'X-AUTH-TOKEN', token],
    [`${CABINET.xsud_url}/auth/api/token/check`, 'X-AUTH-TOKEN', token],
    [`${CABINET.xsud_url}/auth/api/token/check`, 'Authorization', `Bearer ${oneId ?? token}`],
  ];
  for (const [url, header, val] of targets) {
    console.log(`GET ${url}  [${header}]`);
    console.log('  ->', await hit(url, val, header), '\n');
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
