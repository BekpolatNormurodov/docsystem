// SECURITY — server-side identity reconciliation for CLIENT-MODE E-IMZO signing.
//
// In SERVER mode the STIR-match guard is trustworthy: the SERVER itself scanned the
// cert via its local CAPIWS, so `picked.info.tin` is what the server read from the PFX.
//
// In CLIENT mode the cert fields (cn/tin/pinfl) are posted by the browser and are
// UNTRUSTED — a malicious client can claim any STIR. So we must NOT persist a session
// under a firm's account on the strength of the client-claimed cert alone.
//
// Chosen approach: RECONCILIATION (with a documented fallback).
//   After hippo/cabinet authentication succeeds we read back the identity the EXTERNAL
//   service associates with the freshly-issued session (hippo access_token JWT claims;
//   cabinet /user/get + validate-code payload) and compare its STIR to the firm's.
//     - STIR found & mismatched -> REJECT (never persist).
//     - STIR found & equal      -> verified, proceed.
//     - No STIR exposed         -> we cannot cryptographically bind identity here without
//       a heavy PKCS7/ASN.1 parser; fall back to the client-asserted tin for UX only and
//       log a prominent warning (see SECURITY TODO in the callers).
//
// `findStir` is deliberately broad: it deep-scans an identity object for any value under
// a tin/inn/stir-ish key (or the Uzbek STIR OID) so it works whatever the exact claim
// name turns out to be, across hippo and cabinet.

// Uzbek legal-entity STIR/INN is 9 digits; personal PINFL is 14. We reconcile on the
// 9-digit tax id (STIR), which is the firm account key.
const STIR_KEY = /(^|[_.])(tin|inn|stir|nsi_tin|tax_?id|org_?tin|legal_?tin|company_?inn)($|[_.])/i;
const STIR_OID = '1.2.860.3.16.1.1';

function digits(s: unknown): string {
  return String(s ?? '').replace(/\D+/g, '');
}

// Depth-limited deep scan for a STIR-looking value. Returns the first 9-digit value found
// under a STIR-ish key (or the STIR OID). Ignores 14-digit PINFLs.
export function findStir(obj: unknown, depth = 0): string | null {
  if (obj == null || depth > 6) return null;
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = findStir(v, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  // 1) exact STIR OID key (cert-derived claims sometimes carry it verbatim)
  const oid = digits(rec[STIR_OID]);
  if (oid.length === 9) return oid;
  // 2) any tin/inn/stir-ish key with a 9-digit value
  for (const [k, v] of Object.entries(rec)) {
    if (STIR_KEY.test(k)) {
      const d = digits(v);
      if (d.length === 9) return d;
    }
  }
  // 3) recurse into nested objects/arrays
  for (const v of Object.values(rec)) {
    if (v && typeof v === 'object') { const r = findStir(v, depth + 1); if (r) return r; }
  }
  return null;
}

export interface ReconcileResult {
  verified: boolean;   // true only when the service exposed a STIR AND it matched
  foundStir: string | null;
  reason?: string;     // e.g. 'unverified-bypass' when EIMZO_ALLOW_UNVERIFIED let a no-STIR identity through
}

// Compare the external service's identity to the firm account. FAILS CLOSED:
//   - STIR found & mismatched -> THROW (never persist a wrong identity).
//   - STIR found & equal      -> {verified:true}.
//   - No STIR exposed         -> THROW, UNLESS EIMZO_ALLOW_UNVERIFIED=1 (dev/trusted
//     single-tenant escape hatch) in which case {verified:false,reason:'unverified-bypass'}.
// SECURITY: full hardening = extract signer STIR from the PKCS7 via ASN.1 (then this
// no-STIR branch disappears — hippo/cabinet just won't need the bypass).
export function reconcileIdentityOrThrow(
  provider: 'HIPPO' | 'CABINET',
  account: string,
  identity: unknown,
): ReconcileResult {
  const acct = digits(account);
  const found = findStir(identity);
  if (found) {
    if (found !== acct) {
      throw new Error(
        `${provider} identity mismatch: signed-in STIR ${found} ≠ firma STIR ${acct} — imzo boshqa shaxsga tegishli`,
      );
    }
    return { verified: true, foundStir: found };
  }
  // The external service exposed no STIR to reconcile against — a client-asserted cert
  // must NOT bind the session to the firm on its own. Fail closed unless explicitly allowed.
  if (process.env.EIMZO_ALLOW_UNVERIFIED === '1') {
    return { verified: false, foundStir: null, reason: 'unverified-bypass' };
  }
  throw new Error(
    `${provider}: Identity tasdiqlanmadi — imzo egasining STIR aniqlanmadi. Ishonchli/dev muhitda EIMZO_ALLOW_UNVERIFIED=1 qo'ying.`,
  );
}
