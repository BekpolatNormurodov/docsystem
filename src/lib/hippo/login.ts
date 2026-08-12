// xat.hippo.uz key-based login — confirmed against the live frontend bundles
// (SignIn-*.js + missingsign-*.js), 2026-08.
//
// There is NO server challenge: the client PKCS7-signs a fixed constant string
// and POSTs { signature }. The server verifies the signature and reads the cert
// to identify the user/organization. Login was live-verified with the BRIGHT
// (Suvonov Farrux) key -> "E-IMZO Login successful".
import { Eimzo, pickKey, type CertKey } from './eimzo';

export const HIPPO = {
  apiBase: 'https://xat.hippo.uz/api',
  signData: 'TezDoc E-IMZO orqali kirish',   // exact bytes the frontend signs
  detached: 'yes' as const,
  loginPath: '/auth/login/eimzo',
};

export interface HippoSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;      // seconds (604800 = 7 days)
  tokenType: string;      // "bearer"
  key: CertKey;
  raw: any;
}

// Load the key, sign the constant (native E-IMZO password dialog), submit.
export async function loginToHippo(selector?: string): Promise<HippoSession> {
  const key = await pickKey(selector);
  const { keyId } = await Eimzo.loadKey(key.disk, key.path, key.name, key.alias);
  const { pkcs7_64: signature } = await Eimzo.createPkcs7(keyId, HIPPO.signData, HIPPO.detached);

  const res = await fetch(HIPPO.apiBase + HIPPO.loginPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || (json.code && json.code >= 400)) {
    throw new Error(`hippo login ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  const d = json.data || {};
  if (!d.access_token) throw new Error('hippo login: no access_token in response');
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresIn: d.expires_in,
    tokenType: d.token_type || 'bearer',
    key,
    raw: json,
  };
}

const HIPPO_TIMEOUT_MS = 30_000;

// Authenticated fetch helper for subsequent hippo API calls. Hard 30s timeout so a
// hung xat.hippo endpoint can't stall an ingest loop forever (matches cabinet fetchT).
export function hippoFetch(session: HippoSession, path: string, init: RequestInit = {}) {
  const url = path.startsWith('http') ? path : HIPPO.apiBase + path;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HIPPO_TIMEOUT_MS);
  return fetch(url, {
    ...init,
    signal: ctrl.signal,
    headers: {
      ...(init.headers || {}),
      Authorization: `${session.tokenType} ${session.accessToken}`,
    },
  }).finally(() => clearTimeout(t));
}
