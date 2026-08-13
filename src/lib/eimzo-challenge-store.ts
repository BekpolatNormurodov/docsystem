// In-memory, short-TTL store bridging the TWO halves of a client-mode cabinet.sud.uz
// login. In client mode the browser signs the challenge on the USER's machine, so the
// challenge (step 2) and the login (steps 4-6) arrive as TWO separate HTTP requests —
// but they MUST share ONE server context: the OneID token_id minted in step 1 and the
// cookie jar built in steps 1-2. This module holds that context, keyed by a random
// challengeId, until the browser posts back the signed PKCS7.
//
// Module-global Map => survives across requests within the same server process (that is
// enough: the challenge is consumed within seconds, and a fresh process just means the
// user re-signs). Single-writer, in-process only — never a substitute for the DB session
// store, which persists the resulting token.
import { randomUUID } from 'crypto';

// Serialized cabinet CookieJar (see src/lib/cabinet/oneid.ts): [host, [[name, value], ...]].
export type CookieDump = Array<[string, Array<[string, string]>]>;

export interface ChallengeRecord {
  tokenId: string;   // OneID authorize token_id minted in step 1
  cookies: CookieDump; // the cookie jar after steps 1-2 (challenge is cookie-bound)
  scope: string;
  state: string;
  tin?: string;      // the firm's STIR (server-derived) — used for step 5 generate
  createdAt: number;
}

// Short TTL: a challenge is signed within seconds; a stale one is worthless (and its
// OneID token_id/challenge expire server-side anyway). 5 min is generous slack.
const TTL_MS = 5 * 60 * 1000;

const store = new Map<string, ChallengeRecord>();

function cleanup(now = Date.now()): void {
  for (const [id, rec] of store) if (now - rec.createdAt > TTL_MS) store.delete(id);
}

// Persist a fresh challenge context and return its opaque id (crypto.randomUUID()).
export function putChallenge(rec: Omit<ChallengeRecord, 'createdAt'>): string {
  cleanup();
  const id = randomUUID();
  store.set(id, { ...rec, createdAt: Date.now() });
  return id;
}

// Consume a challenge context ONE time (deleted on read). Returns null if unknown or
// expired — the caller then asks the user to restart the sign.
export function takeChallenge(id: string): ChallengeRecord | null {
  cleanup();
  const rec = id ? store.get(id) : undefined;
  if (!rec) return null;
  store.delete(id); // one-time use — a signed challenge is never replayed
  if (Date.now() - rec.createdAt > TTL_MS) return null;
  return rec;
}

// Diagnostics only.
export function challengeCount(): number {
  cleanup();
  return store.size;
}
