// DB-backed xat.hippo.uz sessions. hippo issues a 7-day token (expires_in) + a
// refresh token, so we can store expiresAt and reuse the token for data pulls
// until it expires; then the UI prompts an E-IMZO re-login.
import { loginToHippo, hippoFetch, type HippoSession } from './login';
import {
  saveExternalSession, loadUsableSession, markSessionExpired, SessionExpiredError, decodeJwtClaims,
} from '../session-store';

const PROVIDER = 'HIPPO' as const;

export function accountForSession(s: Pick<HippoSession, 'key'>): string {
  return s.key.info.tin ?? s.key.info.cn ?? 'default';
}

function toSession(row: { accessToken: string; refreshToken: string | null; meta: any }): HippoSession {
  const m = (row.meta ?? {}) as any;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken ?? '',
    expiresIn: m.expiresIn ?? 0,
    tokenType: m.tokenType ?? 'bearer',
    key: m.key ?? ({ info: {} } as any),
    raw: m.raw,
  } as HippoSession;
}

export async function authenticateHippo(selector?: string, account?: string): Promise<HippoSession> {
  const s = await loginToHippo(selector);
  const acct = account ?? accountForSession(s);
  await saveExternalSession(PROVIDER, acct, {
    accessToken: s.accessToken,
    refreshToken: s.refreshToken,
    expiresAt: s.expiresIn ? new Date(Date.now() + s.expiresIn * 1000) : null,
    keyCn: s.key.info.cn,
    org: s.key.info.org,
    meta: {
      expiresIn: s.expiresIn, tokenType: s.tokenType, key: s.key,
      jwt: (() => { const j = decodeJwtClaims(s.accessToken); return j ? { iat: j.iat, exp: j.exp, expiresAt: j.exp && new Date(j.exp * 1000).toISOString() } : null; })(),
    },
  });
  return s;
}

export async function getStoredHippoSession(account: string): Promise<HippoSession> {
  const row = await loadUsableSession(PROVIDER, account);
  if (!row) throw new SessionExpiredError(PROVIDER, account);
  return toSession(row);
}

// Authenticated hippo call that turns a 401 into a typed SessionExpiredError.
export async function hippoCall(account: string, path: string, init?: RequestInit) {
  const s = await getStoredHippoSession(account);
  const res = await hippoFetch(s, path, init);
  if (res.status === 401 || res.status === 403) {
    await markSessionExpired(PROVIDER, account);
    throw new SessionExpiredError(PROVIDER, account, `hippo ${res.status} on ${path} — re-confirm via E-IMZO`);
  }
  return res;
}
