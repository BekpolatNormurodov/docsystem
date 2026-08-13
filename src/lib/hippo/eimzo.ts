// Local E-IMZO client (CAPIWS) wrapper for key-based signing.
//
// The E-IMZO desktop app must be running on the machine (listens on
// wss://127.0.0.1:64443). Verified against E-IMZO v6.4.7, 2026-08.
//
// Quirks handled:
//  - self-signed TLS by NIC/yt.uz            -> rejectUnauthorized:false
//  - Origin allowlist (localhost is built-in) -> send Origin header, else
//    "API-key для домена null недействителен"
//  - CAPIWS closes the socket after EVERY response -> one socket per call
import WebSocket from 'ws';

// E-IMZO CAPIWS lives on the SAME machine as the Node server (127.0.0.1). That holds on a
// Windows/desktop deployment, but a remote Linux server has no local E-IMZO — so the endpoint is
// overridable via EIMZO_WS_URL (e.g. point it at a host running E-IMZO through an SSH/stunnel bridge).
// Unset => the original localhost default, so nothing changes for the desktop setup. See DEPLOYMENT.md.
const URL = process.env.EIMZO_WS_URL || 'wss://127.0.0.1:64443/service/cryptapi';
const ORIGIN = 'https://localhost';

export interface CertInfo {
  raw: Record<string, string>;
  cn?: string;
  org?: string;
  role?: string;
  tin?: string;    // INN / STIR   (OID 1.2.860.3.16.1.1)
  pinfl?: string;  // JShShIR       (OID 1.2.860.3.16.1.2)
  validFrom?: string;
  validTo?: string;
}

export interface CertKey {
  disk: string;
  path: string;
  name: string;
  alias: string;
  info: CertInfo;
}

// CAPIWS (the E-IMZO desktop) serves ONE websocket request at a time — overlapping connections
// deadlock and time out. Verified directly: a single list_certificates finishes in ~330ms, but the
// app was timing out because it fired OVERLAPPING calls (modal-open effect + stale-while-revalidate,
// doubled by React StrictMode). So funnel EVERY CAPIWS call through a global queue: at most one
// request in flight, ever. The per-call timeout starts only once the call is dequeued (below), so a
// queued call is not penalised for time spent waiting behind another.
let _eimzoChain: Promise<unknown> = Promise.resolve();
function rpc<T = any>(payload: unknown, timeoutMs = 120000): Promise<T> {
  const run = _eimzoChain.then(() => rawRpc<T>(payload, timeoutMs));
  _eimzoChain = run.then(() => undefined, () => undefined); // keep the queue alive past a failed call
  return run;
}

function rawRpc<T = any>(payload: unknown, timeoutMs = 120000): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(URL, { rejectUnauthorized: false, headers: { Origin: ORIGIN } });
    const opName = (payload as { name?: string })?.name ?? 'call';
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.terminate(); reject(new Error(`E-IMZO ${opName} timed out (${Math.round(timeoutMs / 1000)}s)`)); }
    }, timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(payload)));
    ws.on('message', (raw: WebSocket.RawData) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let msg: any;
      try { msg = JSON.parse(raw.toString()); }
      catch { ws.close(); return reject(new Error('Bad JSON from E-IMZO: ' + raw)); }
      ws.close();
      if (msg.success === false || msg.success === 'false') {
        reject(new Error(`E-IMZO: ${msg.reason || 'unknown'}${msg.reason_code != null ? ' (code ' + msg.reason_code + ')' : ''}`));
      } else resolve(msg);
    });
    ws.on('error', (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`E-IMZO not reachable on ${URL} — is the desktop app running? (${e.message})`));
    });
  });
}

// Timeouts. `list_disks` is quick, but `list_certificates` PARSES every PFX in DSKEYS and is
// genuinely slow on real machines (measured >12s with ~7 keys, incl. old 2023-format ones) — a
// short cap turned a working scan into a false "DSKEYS boʻsh". Give the enumeration a wide ceiling;
// the picker no longer freezes on it thanks to the server-side cache + the client's own abort.
// Only createPkcs7 keeps the longest ceiling — that one waits on the user typing the PIN.
// Real ops finish in ~330ms (measured); these are only ceilings for a genuinely stuck E-IMZO, kept
// tight so a failure surfaces fast instead of spinning. The serialize() queue above means calls run
// one-at-a-time, so a ceiling never has to cover overlap.
const LIST_DISKS_TIMEOUT_MS = 12_000;
const LIST_CERTS_TIMEOUT_MS = 18_000;
const LOAD_KEY_TIMEOUT_MS = 18_000;

export const Eimzo = {
  listDisks: () => rpc<{ disks: string[] }>({ plugin: 'pfx', name: 'list_disks' }, LIST_DISKS_TIMEOUT_MS),
  listCertificates: (disk: string) =>
    rpc<{ certificates: Omit<CertKey, 'info'>[] }>({ plugin: 'pfx', name: 'list_certificates', arguments: [disk] }, LIST_CERTS_TIMEOUT_MS),
  loadKey: (disk: string, path: string, name: string, alias: string) =>
    rpc<{ keyId: string }>({ plugin: 'pfx', name: 'load_key', arguments: [disk, path, name, alias] }, LOAD_KEY_TIMEOUT_MS),
  // detached 'yes' = signature only (what xat.hippo.uz uses).
  // Shows E-IMZO's OWN native password dialog — the user types the password.
  createPkcs7: (keyId: string, data: string, detached: 'yes' | 'no' = 'yes') =>
    rpc<{ pkcs7_64: string }>({
      plugin: 'pkcs7', name: 'create_pkcs7',
      arguments: [Buffer.from(data, 'utf8').toString('base64'), keyId, detached],
    }),
};

// Enumerate every key visible to the client (scans <disk>:\DSKEYS).
export async function listAllKeys(): Promise<CertKey[]> {
  const { disks } = await Eimzo.listDisks();
  const out: CertKey[] = [];
  for (const disk of disks || []) {
    // A single stuck/empty disk (e.g. a card reader with no card) must NOT block the
    // real DSKEYS keys — time it out (LIST_TIMEOUT_MS) and skip it, keep the rest.
    try {
      const { certificates } = await Eimzo.listCertificates(disk);
      for (const c of certificates || []) out.push({ ...c, info: parseAlias(c.alias) });
    } catch { /* skip this disk, continue enumerating */ }
  }
  return out;
}

// Reconstruct a full CertKey from the {disk,path,name,alias} coordinates the
// key-picker UI posts back. Returns null when the payload isn't a valid picked key
// (so a caller can fall back to a string selector). `info` is derived from alias.
export function parsePickedKey(raw: unknown): CertKey | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const { disk, path, name, alias } = r;
  if (typeof disk === 'string' && typeof path === 'string' && typeof name === 'string' && typeof alias === 'string' && disk && path && name) {
    return { disk, path, name, alias, info: parseAlias(alias) };
  }
  return null;
}

// Build a minimal CertKey from CLIENT-asserted cert fields (client mode: the server
// never scanned the PFX, so there is no disk/path/name/alias — only what the browser
// posts). Used purely to carry cn/org/tin/pinfl into the session record for display;
// identity is verified separately (see eimzo-verify.ts). NEVER treat this as a
// server-scanned key.
export function syntheticKey(cert?: { cn?: string | null; org?: string | null; tin?: string | null; pinfl?: string | null } | null): CertKey {
  const c = cert ?? {};
  return {
    disk: '', path: '', name: '', alias: '',
    info: { raw: {}, cn: c.cn ?? undefined, org: c.org ?? undefined, tin: c.tin ?? undefined, pinfl: c.pinfl ?? undefined },
  };
}

export function parseAlias(alias: string): CertInfo {
  const raw: Record<string, string> = {};
  for (const part of String(alias).split(',')) {
    const i = part.indexOf('=');
    if (i > 0) raw[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return {
    raw,
    cn: raw.cn,
    org: raw.o,
    role: raw.t,
    tin: raw['1.2.860.3.16.1.1'],
    pinfl: raw['1.2.860.3.16.1.2'],
    validFrom: raw.validfrom,
    validTo: raw.validto,
  };
}

// Resolve a signing key from EITHER an explicit CertKey the caller already chose
// (the key-picker UI passes the exact {disk,path,name,alias} — no re-scan, no
// fragile STIR match) OR a string selector routed through pickKey. When the picked
// object carries no parsed `info`, derive it from its alias so downstream code
// (org/cn/tin) still works.
export async function resolveKey(sel?: string | CertKey): Promise<CertKey> {
  if (sel && typeof sel === 'object' && sel.disk && sel.path && sel.name && sel.alias != null) {
    return sel.info ? sel : { ...sel, info: parseAlias(sel.alias) };
  }
  // Not a fully-formed CertKey → route a string selector through pickKey; anything else falls back
  // to the default (BRIGHT) key. (pickKey only accepts a string | undefined.)
  return pickKey(typeof sel === 'string' ? sel : undefined);
}

// Pick a key by index, by CN/file substring, or default to first BRIGHT key.
export async function pickKey(selector?: string): Promise<CertKey> {
  const keys = await listAllKeys();
  if (selector == null) {
    const k = keys.find((k) => /bright/i.test(k.info.org || ''));
    if (!k) throw new Error('No BRIGHT key found in DSKEYS');
    return k;
  }
  const sDigits = selector.replace(/\D/g, '');
  // A STIR/INN selector (7+ digits) matches the certificate's OWN tin (OID 1.2.860.3.16.1.1) —
  // NEVER an array index. Firm connect passes the firm's bare-digit STIR, so this MUST run BEFORE
  // the numeric-index branch, or "311976765" is read as keys[311976765] and every connect fails.
  if (sDigits.length >= 7) {
    const byTin = keys.find((k) => (k.info.tin || '').replace(/\D/g, '') === sDigits);
    if (byTin) return byTin;
    throw new Error(`No key with STIR "${selector}"`);
  }
  if (/^\d+$/.test(selector)) {
    const k = keys[Number(selector)];
    if (!k) throw new Error(`No key at index ${selector}`);
    return k;
  }
  const s = selector.toLowerCase();
  const eq = (v?: string) => (v || '').toLowerCase() === s;
  const has = (v?: string) => (v || '').toLowerCase().includes(s);
  // Prefer an EXACT org/cn/name match before any substring hit, so a name selector like "BRIGHT"
  // never picks a different firm whose org merely contains it ("BRIGHT INVEST") when the exact key
  // is also inserted. Substring stays as a last-resort fallback for partial names.
  const k =
    keys.find((k) => eq(k.info.org) || eq(k.info.cn) || eq(k.name)) ??
    keys.find((k) => has(k.info.cn) || has(k.info.org) || has(k.name));
  if (!k) throw new Error(`No key matching "${selector}"`);
  return k;
}
