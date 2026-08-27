// xat.hippo.uz key-based login — confirmed against the live frontend bundles
// (SignIn-*.js + missingsign-*.js), 2026-08.
//
// There is NO server challenge: the client PKCS7-signs a fixed constant string
// and POSTs { signature }. The server verifies the signature and reads the cert
// to identify the user/organization. Login was live-verified with the BRIGHT
// (Suvonov Farrux) key -> "E-IMZO Login successful".
import { Eimzo, resolveKey, syntheticKey, type CertKey } from './eimzo';

// CLIENT-asserted cert fields (client mode). Untrusted — see src/lib/eimzo-verify.ts.
export interface ClientCert { cn?: string | null; org?: string | null; tin?: string | null; pinfl?: string | null }

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

// POST the PKCS7 signature to hippo and parse the token payload. Shared by BOTH the
// server-sign path (loginToHippo) and the client-sign path (loginToHippoWithSignature),
// so the parse/validation stays in exactly one place.
async function submitHippoSignature(signature: string, key: CertKey): Promise<HippoSession> {
  // 30s ceiling (matches hippoFetch / cabinet fetchT). The signature is already computed, so a
  // stalled /auth/login/eimzo must not hang the connect request indefinitely after the E-IMZO dialog.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HIPPO_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(HIPPO.apiBase + HIPPO.loginPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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

// SERVER MODE: load the key, sign the constant (native E-IMZO password dialog on the
// server machine), submit. `selector` is either an explicit picked key (from the UI) or
// a string routed through pickKey (STIR / name / index). UNCHANGED behaviour.
export async function loginToHippo(selector?: string | CertKey): Promise<HippoSession> {
  const key = await resolveKey(selector);
  const { keyId } = await Eimzo.loadKey(key.disk, key.path, key.name, key.alias);
  const { pkcs7_64: signature } = await Eimzo.createPkcs7(keyId, HIPPO.signData, HIPPO.detached);
  return submitHippoSignature(signature, key);
}

// CLIENT MODE: the browser already signed HIPPO.signData on the USER's machine and posts
// the finished PKCS7. We ONLY do the POST + parse — no local CAPIWS. The cert fields are
// client-asserted (untrusted): they populate the session record for display; identity is
// reconciled against the hippo access_token in authenticateHippo.
export async function loginToHippoWithSignature(pkcs7: string, cert?: ClientCert): Promise<HippoSession> {
  if (!pkcs7) throw new Error('hippo login: pkcs7 (signature) kerak');
  return submitHippoSignature(pkcs7, syntheticKey(cert));
}

const HIPPO_TIMEOUT_MS = 30_000;

// Authenticated fetch helper for subsequent hippo API calls. Hard 30s timeout so a
// hung xat.hippo endpoint can't stall an ingest loop forever (matches cabinet fetchT).
export function hippoFetch(session: HippoSession, path: string, init: RequestInit = {}, timeoutMs = HIPPO_TIMEOUT_MS) {
  const url = path.startsWith('http') ? path : HIPPO.apiBase + path;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, {
    ...init,
    signal: ctrl.signal,
    headers: {
      ...(init.headers || {}),
      Authorization: `${session.tokenType} ${session.accessToken}`,
    },
  }).finally(() => clearTimeout(t));
}
