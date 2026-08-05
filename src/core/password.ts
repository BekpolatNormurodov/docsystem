// Node-only (bcryptjs). Imported via the `@spravka/shared/password` subpath so it never enters an
// edge-runtime bundle (e.g. Next.js middleware). Edge-safe session code lives in ./session.
import bcrypt from 'bcryptjs';

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/*
  `seedPassword()` and SEED_PASSWORD are gone.

  They existed to stop the seed handing every account one password out of a public repository —
  `rahbar` signs maʼlumotnoma, and a login read off GitHub yields a genuinely signed, genuinely
  valid document. The seed now generates a separate random password per account and prints them
  once, so there is no shared default left to guard against. A required env var that no longer
  does anything is worse than none: it reads as protection.
*/
