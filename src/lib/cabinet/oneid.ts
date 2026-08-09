// OneID (id.egov.uz) e-key login -> cabinet.sud.uz session token. FULL REST, no
// browser. The only interactive step is E-IMZO's native password dialog (the user
// types it). Reuses the CAPIWS client from ../hippo/eimzo (DRY).
//
// Flow (all reverse-engineered from the live bundles, login LIVE-VERIFIED with
// BRIGHT's Akram key, 2026-08):
//   1. GET  sso.egov.uz/.../Authorization.do?...        -> 307 -> token_id
//   2. GET  id.egov.uz/api/pkcs/testGetChallenge        -> {challenge}
//   3. CAPIWS create_pkcs7(challenge, key, "no")        -> pkcs7 (password dialog)
//   4. POST id.egov.uz/api/identity/auth/login {pkcs}   -> OneID JWT
//      header X-Authorization-Method: PKCSMETHOD
//   5. POST id.egov.uz/api/sso/v1/generate {uuid:token_id, scope, tin}
//      Bearer JWT                                        -> {code, state, callbackUrl}
//      (tin = the key's own cert STIR; REQUIRED for legal-entity login. token_id
//       must be minted BEFORE login — order matters.)
//   6. POST cabinetapi.sud.uz/api/validate-code {code}  -> {token_id, entity_id,
//      id, pin, username, ...}. token_id IS the cabinet session token, sent as
//      X-AUTH-TOKEN on all later calls.
import { Eimzo, pickKey, type CertKey } from '../hippo/eimzo';
import { CABINET, ONEID, ENDPOINTS } from './config';

// tiny per-host cookie jar (Node fetch does not manage cookies)
class CookieJar {
  private store = new Map<string, Map<string, string>>();
  capture(res: Response, url: string) {
    const host = new URL(url).host;
    const raw = (res.headers as any).getSetCookie?.() ?? [];
    const jar = this.store.get(host) ?? new Map<string, string>();
    for (const line of raw) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if (jar.size) this.store.set(host, jar);
  }
  header(url: string): string {
    const jar = this.store.get(new URL(url).host);
    return jar ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : '';
  }
}

export interface CabinetSession {
  token: string;      // cabinet session token (X-AUTH-TOKEN on later calls)
  oneIdToken: string; // id.egov.uz JWT
  tokenId: string;    // OneID authorize token_id
  key: CertKey;
  user: { entityId?: string; id?: string; pin?: string | number; username?: string; isAdvocate?: boolean };
  raw: { code: string; state: string; callbackUrl?: string };
}

async function jfetch(jar: CookieJar, url: string, init: RequestInit = {}) {
  const cookie = jar.header(url);
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: { accept: 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
  });
  jar.capture(res, url);
  return res;
}

export async function loginToCabinet(
  selector?: string,
  opts: { scope?: string; state?: string; tin?: string } = {},
): Promise<CabinetSession> {
  const scope = opts.scope ?? ONEID.scope;
  const state = opts.state ?? ONEID.state;
  const jar = new CookieJar();

  // 1. mint token_id (BEFORE login)
  const authUrl = `${ONEID.ssoAuthorize}?response_type=one_code&client_id=${ONEID.clientId}` +
    `&redirect_uri=${encodeURIComponent(ONEID.redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
  const authRes = await jfetch(jar, authUrl);
  const loc = authRes.headers.get('location') || '';
  const tokenId = new URL(loc, 'https://id.egov.uz').searchParams.get('token_id');
  if (!tokenId) throw new Error(`token_id not minted (http ${authRes.status}, location=${loc})`);

  // 2. challenge
  const chJson: any = await (await jfetch(jar, `${ONEID.api}${ENDPOINTS.challenge}`)).json();
  const challenge = chJson?.challenge;
  if (!challenge) throw new Error(`no challenge: ${JSON.stringify(chJson)}`);

  // 3. sign the challenge (native password dialog pops up here). detached "no".
  const key = await pickKey(selector);
  const { keyId } = await Eimzo.loadKey(key.disk, key.path, key.name, key.alias);
  const { pkcs7_64 } = await Eimzo.createPkcs7(keyId, challenge, 'no');
  if (process.env.DEBUG) console.error(`[dbg] key=${key.info.cn} tin=${key.info.tin} pinfl=${key.info.pinfl} | challenge=${challenge} | pkcs len=${pkcs7_64?.length}`);

  // 4. login with pkcs7
  const loginJson: any = await (await jfetch(jar, `${ONEID.api}${ENDPOINTS.login}`, {
    method: 'POST',
    // Match the real web client exactly. `accept-language: latin` is REQUIRED for
    // some legal-entity certs (e.g. Community/mamadaliyev) — without it id.egov
    // returns 400 "Type mismatch" while resolving the certificate name; BRIGHT's
    // key happened to work without it, others do not.
    headers: {
      'Content-Type': 'application/json', 'X-Authorization-Method': ONEID.authMethod,
      'accept-language': 'latin', 'x-origin': 'web-client', 'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify({ pkcs: pkcs7_64 }),
  })).json().catch(() => ({}));
  const oneIdToken = loginJson?.token;
  if (!oneIdToken) throw new Error(`OneID login failed: ${JSON.stringify(loginJson).slice(0, 200)}`);

  // 5. mint the client code for cabinet — tin = the key's own STIR (legal entity)
  const tin = opts.tin ?? key.info.tin;
  const genJson: any = await (await jfetch(jar, `${ONEID.api}${ENDPOINTS.ssoGenerate}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oneIdToken}` },
    body: JSON.stringify({ uuid: tokenId, scope, ...(tin ? { tin } : {}) }),
  })).json().catch(() => ({}));
  const code = genJson?.code, gstate = genJson?.state ?? state, callbackUrl = genJson?.callbackUrl;
  if (!code) throw new Error(`sso generate failed: ${JSON.stringify(genJson).slice(0, 200)}`);

  // 6. exchange code for the cabinet session token
  const valRes = await fetch(`${CABINET.base_url}${ENDPOINTS.validateCode}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const valJson: any = await valRes.json().catch(() => ({}));
  const token = valJson?.token_id ?? valJson?.token;
  if (!token) throw new Error(`cabinet validate-code failed (http ${valRes.status}): ${JSON.stringify(valJson).slice(0, 200)}`);

  return {
    token, oneIdToken, tokenId, key,
    user: { entityId: valJson?.entity_id, id: valJson?.id, pin: valJson?.pin, username: valJson?.username, isAdvocate: valJson?.is_advocate },
    raw: { code, state: gstate, callbackUrl },
  };
}
