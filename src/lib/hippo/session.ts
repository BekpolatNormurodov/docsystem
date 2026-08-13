// DB-backed xat.hippo.uz sessions. hippo issues a 7-day token (expires_in) + a
// refresh token, so we can store expiresAt and reuse the token for data pulls
// until it expires; then the UI prompts an E-IMZO re-login.
import { loginToHippo, loginToHippoWithSignature, hippoFetch, type HippoSession, type ClientCert } from './login';
import type { CertKey } from './eimzo';
import {
  saveExternalSession, loadUsableSession, markSessionExpired, SessionExpiredError, decodeJwtClaims,
} from '../session-store';
import { reconcileIdentityOrThrow } from '../eimzo-verify';

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

// `opts.pkcs7` (CLIENT mode) => the browser already produced the PKCS7; we skip the local
// CAPIWS sign and only submit it, then RECONCILE the resulting hippo identity against the
// firm account before persisting. Without opts (SERVER mode) the behaviour is UNCHANGED.
export async function authenticateHippo(
  selector?: string | CertKey,
  account?: string,
  opts?: { pkcs7?: string; cert?: ClientCert },
): Promise<HippoSession> {
  const s = opts?.pkcs7
    ? await loginToHippoWithSignature(opts.pkcs7, opts.cert)
    : await loginToHippo(selector);
  const acct = account ?? accountForSession(s);

  // CLIENT MODE only: the cert is client-asserted (untrusted). Reconcile the identity the
  // hippo access_token carries against the firm's STIR before storing the session.
  if (opts?.pkcs7) {
    const claims = decodeJwtClaims(s.accessToken) ?? {};
    const { verified } = reconcileIdentityOrThrow(PROVIDER, acct, { ...claims, ...(s.raw?.data ?? {}) });
    if (!verified) {
      // SECURITY TODO (client mode): identity is client-asserted; harden by parsing the
      // signer cert STIR from the PKCS7 before multi-tenant prod. The hippo access_token
      // exposed no STIR to reconcile, so we trusted the client-sent tin for the UX check only.
      console.warn(`[SECURITY] HIPPO client-mode: no STIR in access_token to reconcile for account ${acct}; identity is CLIENT-ASSERTED (tin=${opts.cert?.tin ?? 'none'}).`);
    }
  }

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
