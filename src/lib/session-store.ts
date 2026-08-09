// Persistent store for external e-gov sessions (xat.hippo.uz + cabinet.sud.uz).
// Lets the system reuse a stored token to keep pulling data until it expires;
// when a token is past expiry or rejected, callers get a SessionExpiredError so
// the UI can prompt the user to re-confirm via E-IMZO.
import type { ExtProvider, ExternalSession, Prisma } from '@prisma/client';
import { prisma } from './db';

// Refresh a bit early so we never hand out a token that dies mid-request.
const EXPIRY_SKEW_MS = 5 * 60 * 1000; // 5 min

// Decode a JWT payload (no verification) — used to record token iat/exp.
export function decodeJwtClaims(jwt?: string | null): { iat?: number; exp?: number; [k: string]: any } | null {
  if (!jwt || jwt.split('.').length < 2) return null;
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8')); } catch { return null; }
}
// The JWT's exp as a Date (or null).
export function jwtExpiry(jwt?: string | null): Date | null {
  const c = decodeJwtClaims(jwt);
  return c?.exp ? new Date(c.exp * 1000) : null;
}

export class SessionExpiredError extends Error {
  constructor(public provider: ExtProvider, public account: string, msg?: string) {
    super(msg ?? `${provider} session for "${account}" needs re-authentication via E-IMZO`);
    this.name = 'SessionExpiredError';
  }
}

export interface SaveSessionInput {
  accessToken: string;
  refreshToken?: string | null;
  tokenId?: string | null;
  expiresAt?: Date | null; // known for hippo; null for cabinet (verify via API)
  keyCn?: string | null;
  org?: string | null;
  meta?: unknown; // any JSON-serialisable blob (normalised below)
}

export async function saveExternalSession(
  provider: ExtProvider,
  account: string,
  data: SaveSessionInput,
): Promise<ExternalSession> {
  const base = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? null,
    tokenId: data.tokenId ?? null,
    expiresAt: data.expiresAt ?? null,
    keyCn: data.keyCn ?? null,
    org: data.org ?? null,
    meta: (data.meta === undefined ? undefined : JSON.parse(JSON.stringify(data.meta))) as Prisma.InputJsonValue,
    status: 'ACTIVE' as const,
    lastUsedAt: new Date(),
  };
  return prisma.externalSession.upsert({
    where: { provider_account: { provider, account } },
    create: { provider, account, ...base },
    update: base,
  });
}

// Not expired by the stored clock. Cabinet sessions carry no expiresAt, so this
// returns true for them — liveness is confirmed by an actual API call instead.
export function isFresh(s: ExternalSession): boolean {
  if (s.status !== 'ACTIVE') return false;
  if (!s.expiresAt) return true;
  return s.expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();
}

// Load a session that is safe to use. Returns null when none exists or it is
// stale (and marks a stale one EXPIRED as a side effect).
export async function loadUsableSession(
  provider: ExtProvider,
  account: string,
): Promise<ExternalSession | null> {
  const s = await prisma.externalSession.findUnique({
    where: { provider_account: { provider, account } },
  });
  if (!s) return null;
  if (!isFresh(s)) {
    if (s.status === 'ACTIVE') await markSessionExpired(provider, account);
    return null;
  }
  await prisma.externalSession.update({
    where: { provider_account: { provider, account } },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});
  return s;
}

export const markSessionExpired = (provider: ExtProvider, account: string) =>
  prisma.externalSession.update({
    where: { provider_account: { provider, account } },
    data: { status: 'EXPIRED' },
  }).catch(() => undefined);

export const markSessionRevoked = (provider: ExtProvider, account: string) =>
  prisma.externalSession.update({
    where: { provider_account: { provider, account } },
    data: { status: 'REVOKED' },
  }).catch(() => undefined);

// For the UI: list every integration session and whether it needs re-auth.
export async function sessionStatuses() {
  const rows = await prisma.externalSession.findMany({ orderBy: [{ provider: 'asc' }, { account: 'asc' }] });
  return rows.map((s) => ({
    provider: s.provider,
    account: s.account,
    org: s.org,
    keyCn: s.keyCn,
    status: isFresh(s) ? 'ACTIVE' : 'NEEDS_REAUTH',
    expiresAt: s.expiresAt,
    lastUsedAt: s.lastUsedAt,
    needsReauth: !isFresh(s),
  }));
}
