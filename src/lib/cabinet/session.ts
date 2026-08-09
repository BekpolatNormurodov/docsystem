// DB-backed cabinet.sud.uz sessions. authenticate once (E-IMZO), reuse the stored
// token to pull data; when the server rejects it, mark EXPIRED and surface a
// SessionExpiredError so the UI can ask the user to re-confirm via E-IMZO.
import { loginToCabinet, type CabinetSession } from './oneid';
import { cabinetFetch, getUser } from './api';
import {
  saveExternalSession, loadUsableSession, markSessionExpired, SessionExpiredError, decodeJwtClaims,
} from '../session-store';

const PROVIDER = 'CABINET' as const;

// Stable per-firm key: the org STIR (falls back to CN). Same account across logins.
export function accountForSession(s: Pick<CabinetSession, 'key'>): string {
  return s.key.info.tin ?? s.key.info.cn ?? 'default';
}

// Reconstruct the in-memory session object from a stored row (only `token` is
// needed for authenticated calls; the rest is informational).
function toSession(row: { accessToken: string; tokenId: string | null; meta: any }): CabinetSession {
  const m = (row.meta ?? {}) as any;
  return {
    token: row.accessToken,
    oneIdToken: m.oneIdToken ?? '',
    tokenId: row.tokenId ?? '',
    key: m.key ?? ({ info: {} } as any),
    user: m.user ?? {},
    raw: m.raw ?? { code: '', state: '' },
  };
}

// Full E-IMZO login, then persist. Cabinet tokens carry no server expiry, so we
// store expiresAt=null and rely on liveness checks (getUser) instead.
export async function authenticateCabinet(selector?: string, account?: string): Promise<CabinetSession> {
  const s = await loginToCabinet(selector);
  const acct = account ?? accountForSession(s);
  // The OneID login JWT carries iat/exp (~2h) — the id.egov login window, NOT the
  // cabinet session lifetime. Persist it for the record; the cabinet session token
  // (token_id) has no declared expiry and is validated per-call (expiresAt=null).
  const jwt = decodeJwtClaims(s.oneIdToken);
  await saveExternalSession(PROVIDER, acct, {
    accessToken: s.token,
    tokenId: s.tokenId,
    expiresAt: null, // cabinet: verified via API, not a clock
    keyCn: s.key.info.cn,
    org: s.key.info.org,
    meta: {
      oneIdToken: s.oneIdToken, key: s.key, user: s.user, raw: s.raw,
      jwt: jwt ? { iat: jwt.iat, exp: jwt.exp, issuedAt: jwt.iat && new Date(jwt.iat * 1000).toISOString(), expiresAt: jwt.exp && new Date(jwt.exp * 1000).toISOString() } : null,
    },
  });
  return s;
}

// Get a usable session from the DB WITHOUT signing. Throws SessionExpiredError if
// none is stored/active — the caller (or UI) then triggers authenticateCabinet.
export async function getStoredCabinetSession(account: string): Promise<CabinetSession> {
  const row = await loadUsableSession(PROVIDER, account);
  if (!row) throw new SessionExpiredError(PROVIDER, account);
  return toSession(row);
}

// Confirm the stored token still works (calls /user/get). On rejection marks the
// session EXPIRED and throws SessionExpiredError.
export async function verifyCabinetSession(account: string): Promise<CabinetSession> {
  const s = await getStoredCabinetSession(account);
  const me = await getUser(s);
  if (me.status === 401 || me.status === 403 || !me.ok) {
    await markSessionExpired(PROVIDER, account);
    throw new SessionExpiredError(PROVIDER, account, 'cabinet token rejected — re-confirm via E-IMZO');
  }
  return s;
}

// Wrapper for any authenticated cabinet call that turns a 401/403 into a typed
// SessionExpiredError (and marks the session), so data-pull code has one place to
// detect "needs re-auth".
export async function cabinetCall(account: string, path: string, init?: RequestInit) {
  const s = await getStoredCabinetSession(account);
  const res = await cabinetFetch(s, path, init);
  if (res.status === 401 || res.status === 403) {
    await markSessionExpired(PROVIDER, account);
    throw new SessionExpiredError(PROVIDER, account, `cabinet ${res.status} on ${path} — re-confirm via E-IMZO`);
  }
  return res;
}
