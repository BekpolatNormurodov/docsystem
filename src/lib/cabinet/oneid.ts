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
import { Eimzo, resolveKey, syntheticKey, type CertKey } from '../hippo/eimzo';
import type { ClientCert } from '../hippo/login';
import { CABINET, ONEID, ENDPOINTS } from './config';
import { putChallenge, takeChallenge, type CookieDump } from '../eimzo-challenge-store';
import { proxyDispatcher } from './api';

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
  // Serialize/restore — client mode splits the flow across two HTTP requests, so the jar
  // built in steps 1-2 (the challenge is cookie-bound) must be stashed and reloaded.
  dump(): CookieDump {
    return [...this.store].map(([host, jar]) => [host, [...jar]]);
  }
  static restore(dump: CookieDump): CookieJar {
    const j = new CookieJar();
    for (const [host, entries] of dump ?? []) j.store.set(host, new Map(entries));
    return j;
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

// Hard per-call timeout. Without it a slow/unreachable egov or cabinet endpoint hangs the whole
// connect forever (the E-IMZO dialog is step 3, so steps 1-2 stalling means no dialog ever shows —
// the UI just spins). Turn that into a clear "which host didn't answer" error instead. Keeps the
// caller's redirect mode: jfetch needs 'manual' to read the 307 token_id; step 6 needs follow.
const ONEID_TIMEOUT_MS = 30_000;

// *.sud.uz (not id.egov.uz/sso.egov.uz — those already reach fine) is intermittently
// unreachable from this container's bridge network; tunnel just those calls through the
// host-network cabinet-proxy sidecar. See src/lib/cabinet/api.ts for the full rationale.
function dispatcherFor(url: string): unknown {
  try { return /(^|\.)sud\.uz$/i.test(new URL(url).hostname) ? proxyDispatcher() : undefined; }
  catch { return undefined; }
}

async function fetchT(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ONEID_TIMEOUT_MS);
  const disp = dispatcherFor(url);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, ...(disp ? { dispatcher: disp } : {}) } as RequestInit);
  } catch (e) {
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    if ((e as { name?: string })?.name === 'AbortError') throw new Error(`${host} javob bermadi (${ONEID_TIMEOUT_MS / 1000}s timeout)`);
    throw new Error(`${host} ulanib boʻlmadi: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function jfetch(jar: CookieJar, url: string, init: RequestInit = {}) {
  const cookie = jar.header(url);
  const res = await fetchT(url, {
    ...init,
    redirect: 'manual',
    headers: { accept: 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
  });
  jar.capture(res, url);
  return res;
}

// Steps 1-2: mint the OneID token_id and fetch the (cookie-bound) challenge. Shared by
// server-mode loginToCabinet and client-mode cabinetChallenge.
async function mintChallenge(jar: CookieJar, scope: string, state: string): Promise<{ tokenId: string; challenge: string }> {
  // 1. mint token_id (BEFORE login)
  const authUrl = `${ONEID.ssoAuthorize}?response_type=one_code&client_id=${ONEID.clientId}` +
    `&redirect_uri=${encodeURIComponent(ONEID.redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
  const authRes = await jfetch(jar, authUrl);
  const loc = authRes.headers.get('location') || '';
  const tokenId = new URL(loc, 'https://id.egov.uz').searchParams.get('token_id');
  if (!tokenId) throw new Error(`token_id not minted (http ${authRes.status}, location=${loc})`);

  // 2. challenge
  const chRes = await jfetch(jar, `${ONEID.api}${ENDPOINTS.challenge}`);
  const chJson: any = await chRes.json().catch(() => ({})); // degraded gateway may return HTML, not JSON
  const challenge = chJson?.challenge;
  if (!challenge) throw new Error(`no challenge (http ${chRes.status}): ${JSON.stringify(chJson).slice(0, 200)}`);
  return { tokenId, challenge };
}

// Steps 4-6: OneID login with the signed PKCS7 → sso generate → cabinet validate-code.
// Shared by both modes; `key` carries the identity into the session record.
async function finishCabinetLogin(
  jar: CookieJar, tokenId: string, scope: string, state: string, pkcs7_64: string, tin: string | undefined, key: CertKey,
): Promise<CabinetSession> {
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
  const genJson: any = await (await jfetch(jar, `${ONEID.api}${ENDPOINTS.ssoGenerate}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oneIdToken}` },
    body: JSON.stringify({ uuid: tokenId, scope, ...(tin ? { tin } : {}) }),
  })).json().catch(() => ({}));
  const code = genJson?.code, gstate = genJson?.state ?? state, callbackUrl = genJson?.callbackUrl;
  if (!code) throw new Error(`sso generate failed: ${JSON.stringify(genJson).slice(0, 200)}`);

  // 6. exchange code for the cabinet session token (fetchT = same timeout guard, default redirect)
  const valRes = await fetchT(`${CABINET.base_url}${ENDPOINTS.validateCode}`, {
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

// SERVER MODE: full flow in one process — mint challenge, sign it via the LOCAL E-IMZO
// (native password dialog, step 3), then finish. Behaviour UNCHANGED from the original.
export async function loginToCabinet(
  selector?: string | CertKey,
  opts: { scope?: string; state?: string; tin?: string } = {},
): Promise<CabinetSession> {
  const scope = opts.scope ?? ONEID.scope;
  const state = opts.state ?? ONEID.state;
  const jar = new CookieJar();

  const { tokenId, challenge } = await mintChallenge(jar, scope, state);

  // 3. sign the challenge (native password dialog pops up here). detached "no".
  const key = await resolveKey(selector);
  const { keyId } = await Eimzo.loadKey(key.disk, key.path, key.name, key.alias);
  const { pkcs7_64 } = await Eimzo.createPkcs7(keyId, challenge, 'no');
  // Don't log the signer's STIR/JShShIR (PII) — only the CN + signature length.
  if (process.env.DEBUG) console.error(`[dbg] key=${key.info.cn} | challenge set | pkcs len=${pkcs7_64?.length}`);

  return finishCabinetLogin(jar, tokenId, scope, state, pkcs7_64, opts.tin ?? key.info.tin, key);
}

// CLIENT MODE — half 1: mint token_id + challenge on the SERVER, stash the cookie jar +
// token_id under a random challengeId, and hand the raw challenge to the browser to sign
// on the USER's machine. `tin` is the firm's STIR (server-derived) for step 5.
export async function cabinetChallenge(
  opts: { scope?: string; state?: string; tin?: string } = {},
): Promise<{ challengeId: string; challenge: string }> {
  const scope = opts.scope ?? ONEID.scope;
  const state = opts.state ?? ONEID.state;
  const jar = new CookieJar();
  const { tokenId, challenge } = await mintChallenge(jar, scope, state);
  const challengeId = putChallenge({ tokenId, cookies: jar.dump(), scope, state, tin: opts.tin });
  return { challengeId, challenge };
}

// CLIENT MODE — half 2: the browser posts back the PKCS7 it signed. Reload the saved jar +
// token_id and run steps 4-6 in the SAME server context. The cert is client-asserted
// (untrusted) — it only populates the session record; identity is reconciled in
// authenticateCabinet. `tin` prefers the server-stored firm STIR.
//
// SECURITY (Fix B): the challengeId is opaque and the challenge was minted with tin=firm
// (cabinetChallenge). Bind it to the SAME firm here — assert saved.tin === account — so a
// caller can't pair an arbitrary challengeId with a different firmId and store the session
// under the wrong account.
export async function cabinetLoginWithSignature(
  challengeId: string, pkcs7: string, account: string, cert?: ClientCert,
): Promise<CabinetSession> {
  if (!pkcs7) throw new Error('cabinet login: pkcs7 kerak');
  const saved = takeChallenge(challengeId);
  if (!saved) throw new Error('Challenge topilmadi yoki muddati tugadi — qaytadan urinib koʻring');
  if (saved.tin !== account) throw new Error('Challenge boshqa firma uchun yaratilgan');
  const jar = CookieJar.restore(saved.cookies);
  const tin = saved.tin ?? cert?.tin ?? undefined;
  return finishCabinetLogin(jar, saved.tokenId, saved.scope, saved.state, pkcs7, tin ?? undefined, syntheticKey(cert));
}
