// Where E-IMZO signing happens.
//   'server' (DEFAULT) — the Node server talks to a local CAPIWS (127.0.0.1:64443).
//     This is the existing Windows/desktop deployment; unchanged.
//   'client'          — the USER's browser talks to THEIR local E-IMZO; the server
//     only receives the finished PKCS7 (dev-mode / remote-server ready).
// Read from EIMZO_MODE. Anything other than the exact string 'client' is 'server',
// so a missing/typo'd value can never silently disable the desktop flow.
export type EimzoMode = 'server' | 'client';

export function eimzoMode(): EimzoMode {
  return process.env.EIMZO_MODE === 'client' ? 'client' : 'server';
}
