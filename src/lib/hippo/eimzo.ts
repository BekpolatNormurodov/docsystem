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

const URL = 'wss://127.0.0.1:64443/service/cryptapi';
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

function rpc<T = any>(payload: unknown, timeoutMs = 120000): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(URL, { rejectUnauthorized: false, headers: { Origin: ORIGIN } });
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.terminate(); reject(new Error('E-IMZO call timed out')); }
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

export const Eimzo = {
  listDisks: () => rpc<{ disks: string[] }>({ plugin: 'pfx', name: 'list_disks' }),
  listCertificates: (disk: string) =>
    rpc<{ certificates: Omit<CertKey, 'info'>[] }>({ plugin: 'pfx', name: 'list_certificates', arguments: [disk] }),
  loadKey: (disk: string, path: string, name: string, alias: string) =>
    rpc<{ keyId: string }>({ plugin: 'pfx', name: 'load_key', arguments: [disk, path, name, alias] }),
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
    const { certificates } = await Eimzo.listCertificates(disk);
    for (const c of certificates || []) out.push({ ...c, info: parseAlias(c.alias) });
  }
  return out;
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
  const k = keys.find((k) =>
    (k.info.cn || '').toLowerCase().includes(s) ||
    (k.info.org || '').toLowerCase().includes(s) ||
    k.name.toLowerCase().includes(s),
  );
  if (!k) throw new Error(`No key matching "${selector}"`);
  return k;
}
